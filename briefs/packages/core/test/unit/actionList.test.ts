import { describe, expect, it } from "vitest";
import {
  actionListSql, compareRows, DEFAULT_PAGE_SIZE, intentStatusesFor, listActions, matchesSearch, MAX_PAGE_SIZE, normalizeListQuery, pageOf, rowStatusOf, searchFacets, searchWords,
  type ActionListItem, type ActionListQuery,
} from "../../src/actions/index.js";
import { actionPermissions, fieldsProblem, matterBlockReason, originLabelOf, paramsFromFields, runTitleOf } from "../../src/actions/index.js";
import { bodyOf, displayTitleOf, titleOf, unsupportedTypeLabel } from "../../src/intent/index.js";

function item(id: string, change: Partial<ActionListItem> = {}): ActionListItem {
  return {
    id, kind: "task", title: `Title ${id}`, detail: "", meetingID: "mtg_1", meetingTitle: "Weekly review", matter: null, status: "review", origin: "meeting",
    createdAt: `2026-11-0${id.length}T10:00:00.000Z`, updatedAt: "2026-11-01T10:00:00.000Z", deletedAt: null, unread: false, ...change,
  };
}

function query(change: Partial<ActionListQuery> = {}): ActionListQuery {
  return { ...normalizeListQuery({}), ...change };
}

describe("list request", () => {
  it("falls back for anything missing or unknown and clamps numbers", () => {
    expect(normalizeListQuery(undefined)).toEqual({
      query: "", filters: { status: [], kind: [], meetingID: undefined, matterID: undefined, deleted: false, unread: false }, sort: { by: "created", dir: "desc" }, page: 1, pageSize: DEFAULT_PAGE_SIZE,
    });
    const odd = normalizeListQuery({
      query: `  ${"x".repeat(500)}  `, filters: { status: ["review", "bogus", "review"], kind: ["note", 4], meetingID: " ", matterID: "m1", deleted: "yes" },
      sort: { by: "drop table", dir: "sideways" }, page: -3, pageSize: 10_000,
    });
    expect(odd.query).toHaveLength(200);
    expect(odd.filters).toEqual({ status: ["review"], kind: ["note"], meetingID: undefined, matterID: "m1", deleted: false, unread: false });
    expect(odd.sort).toEqual({ by: "created", dir: "desc" });
    expect(odd.page).toBe(1);
    expect(odd.pageSize).toBe(MAX_PAGE_SIZE);
    expect(normalizeListQuery({ sort: { by: "title" }, page: 2.7, pageSize: 0 })).toMatchObject({ sort: { by: "title", dir: "asc" }, page: 2, pageSize: 1 });
  });
});

describe("status mapping", () => {
  it("maps every stored status to a row status, and back for the SQL filter", () => {
    expect(["proposed", "transferred", "resolved", "confirmed", "executed", "failed", "undone", "dismissed"].map((status) => rowStatusOf(status as never, "task")))
      .toEqual(["review", "review", "review", "interrupted", "ran", "failed", "undone", "dismissed"]);
    expect(intentStatusesFor([])).toBeNull();
    expect(intentStatusesFor(["review", "ran"])).toEqual(["executed", "proposed", "resolved", "transferred"]);
    expect(intentStatusesFor(["waiting", "drafting"])).toEqual([]);
  });

  it("reads a type this version cannot run as Not supported, never To review", () => {
    expect(["proposed", "transferred", "resolved", "dismissed", "undone"].map((status) => rowStatusOf(status as never, "unsupported")))
      .toEqual(["unsupported", "unsupported", "unsupported", "dismissed", "undone"]);
    expect(intentStatusesFor(["unsupported"])).toEqual(["proposed", "resolved", "transferred"]);
    expect(normalizeListQuery({ filters: { status: ["unsupported"] } }).filters.status).toEqual(["unsupported"]);
  });
});

describe("SQL for the indexed filters", () => {
  it("hides deleted rows unless asked, and binds every value", () => {
    expect(actionListSql({ status: [], kind: [] })).toEqual({ where: "WHERE deleted_at IS NULL", params: [], empty: false });
    expect(actionListSql({ status: [], kind: [], deleted: true }).where).toBe("WHERE deleted_at IS NOT NULL");
    const all = actionListSql({ status: ["failed", "interrupted"], kind: ["task", "note"], meetingID: "mtg_'; DROP TABLE intent; --" });
    expect(all.where).toBe("WHERE deleted_at IS NULL AND status IN (?, ?) AND type IN (?, ?) AND meeting_id = ?");
    expect(all.params).toEqual(["confirmed", "failed", "note.log", "task.create", "mtg_'; DROP TABLE intent; --"]);
  });

  it("covers unknown types for the newer type filter, and is empty for draft only statuses", () => {
    expect(actionListSql({ status: [], kind: ["unsupported"] }).where).toBe("WHERE deleted_at IS NULL AND type NOT IN ('note.log', 'task.create', 'email.draft')");
    expect(actionListSql({ status: [], kind: ["email", "unsupported"] }).where).toBe("WHERE deleted_at IS NULL AND (type IN (?) OR type NOT IN ('note.log', 'task.create', 'email.draft'))");
    expect(actionListSql({ status: ["drafting"], kind: [] }).empty).toBe(true);
  });
});

describe("filters, search, sort and pages", () => {
  const rows = [
    item("a", { title: "Draft audit demand", matter: { id: "m42", label: "00042 Acme Logistics", detail: "Northgate lease" }, status: "ran", kind: "task" }),
    item("bb", { title: "Brightline intake summary", meetingID: "mtg_2", meetingTitle: "Brightline intake", kind: "note" }),
    item("ccc", { title: "Call the client", meetingID: null, meetingTitle: null, origin: "manual", status: "failed" }),
    item("dddd", { title: "Old notes", deletedAt: "2026-11-02T00:00:00.000Z", kind: "note" }),
    item("eeeee", { title: "Is there an Ohio clause?", kind: null, status: "drafting", origin: "draft" }),
    item("ffffff", { title: "Calendar event", kind: "unsupported", status: "unsupported", detail: "Hearing on the Ohio motion" }),
  ];

  it("applies every filter", () => {
    const titles = (change: Partial<ActionListQuery["filters"]>) => listActions(rows, query({ filters: { status: [], kind: [], ...change } })).rows.map((row) => row.id);
    expect(titles({})).toEqual(["ffffff", "eeeee", "ccc", "bb", "a"]);
    expect(titles({ status: ["ran"] })).toEqual(["a"]);
    expect(titles({ status: ["review"] })).toEqual(["bb"]);
    expect(titles({ status: ["unsupported"] })).toEqual(["ffffff"]);
    expect(titles({ status: ["drafting", "failed"] })).toEqual(["eeeee", "ccc"]);
    expect(titles({ kind: ["note"] })).toEqual(["bb"]);
    expect(titles({ meetingID: "mtg_2" })).toEqual(["bb"]);
    expect(titles({ matterID: "m42" })).toEqual(["a"]);
    expect(titles({ deleted: true })).toEqual(["dddd"]);
    expect(titles({ meetingID: "mtg_1", matterID: "m42" })).toEqual(["a"]);
    expect(titles({ meetingID: "mtg_2", matterID: "m42" })).toEqual([]);
  });

  it("combines free text with the meeting and matter tokens", () => {
    const ids = (text: string, change: Partial<ActionListQuery["filters"]>) => listActions(rows, query({ query: text, filters: { status: [], kind: [], ...change } })).rows.map((row) => row.id);
    expect(ids("ohio", {})).toEqual(["ffffff", "eeeee"]);
    expect(ids("ohio", { meetingID: "mtg_1" })).toEqual(["ffffff", "eeeee"]);
    expect(ids("demand", { matterID: "m42" })).toEqual(["a"]);
    expect(ids("summary", { matterID: "m42" })).toEqual([]);
  });

  it("lists each meeting and matter once, A to Z, for suggestions", () => {
    expect(searchFacets(rows)).toEqual({
      meetings: [{ id: "mtg_2", title: "Brightline intake" }, { id: "mtg_1", title: "Weekly review" }],
      matters: [{ id: "m42", label: "00042 Acme Logistics" }],
    });
    expect(searchFacets([item("x", { meetingTitle: " " })])).toEqual({ meetings: [], matters: [] });
    expect(searchWords("  ACMÉ   Lease ")).toEqual(["acme", "lease"]);
  });

  it("searches every word in the title, detail, meeting and matter, ignoring case and accents", () => {
    expect(matchesSearch(rows[0]!, "ACMÉ demand")).toBe(true);
    expect(matchesSearch(rows[0]!, "northgate")).toBe(true);
    expect(matchesSearch(rows[1]!, "brightline intake")).toBe(true);
    expect(matchesSearch(rows[1]!, "brightline acme")).toBe(false);
    expect(matchesSearch(rows[2]!, "   ")).toBe(true);
    expect(matchesSearch(rows[5]!, "hearing motion")).toBe(true);
    expect(listActions(rows, query({ query: "acme" })).rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("sorts on every column both ways, with empty values last and a stable tie break", () => {
    const visible = rows.filter((row) => row.deletedAt === null && row.kind !== "unsupported");
    const order = (by: ActionListQuery["sort"]["by"], dir: "asc" | "desc") => [...visible].sort(compareRows(by, dir)).map((row) => row.id);
    expect(order("title", "asc")).toEqual(["bb", "ccc", "a", "eeeee"]);
    expect(order("title", "desc")).toEqual(["eeeee", "a", "ccc", "bb"]);
    expect(order("meeting", "asc")).toEqual(["bb", "eeeee", "a", "ccc"]);
    expect(order("meeting", "desc").at(-1)).toBe("ccc");
    expect(order("matter", "asc")).toEqual(["a", "eeeee", "ccc", "bb"]);
    expect(order("status", "asc")).toEqual(["eeeee", "bb", "ccc", "a"]);
    expect(order("kind", "asc")).toEqual(["ccc", "a", "bb", "eeeee"]);
    expect(order("created", "asc")).toEqual(["a", "bb", "ccc", "eeeee"]);
    expect(order("updated", "desc")).toEqual(["eeeee", "ccc", "bb", "a"]);
  });

  it("pages 25 at a time and clamps a page past the end", () => {
    const many = Array.from({ length: 51 }, (_, index) => item(`id${String(index).padStart(2, "0")}`, { createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString() }));
    expect(pageOf(many, 1, 25)).toMatchObject({ total: 51, page: 1 });
    expect(pageOf(many, 3, 25).rows).toHaveLength(1);
    expect(pageOf(many, 9, 25)).toMatchObject({ page: 3 });
    expect(pageOf(many, 0, 25)).toMatchObject({ page: 1 });
    expect(pageOf([], 4, 25)).toEqual({ rows: [], total: 0, page: 1, pageSize: 25 });
    expect(pageOf(many.slice(0, 50), 2, 25).rows).toHaveLength(25);
    const second = listActions(many, query({ page: 2 }));
    expect(second.rows[0]?.id).toBe("id25");
  });
});

describe("action rules", () => {
  it("checks the fields", () => {
    expect(fieldsProblem("task", { title: "  ", body: "", dueDate: null })).toBe("Add a task.");
    expect(fieldsProblem("note", { title: "", body: "", dueDate: null })).toBe("Add a subject.");
    expect(fieldsProblem("task", { title: "x".repeat(301), body: "", dueDate: null })).toBe("Keep the task under 300 characters.");
    expect(fieldsProblem("task", { title: "Call", body: "", dueDate: "2026-02-30" })).toBe("Choose a real due date.");
    expect(fieldsProblem("task", { title: "Call", body: "", dueDate: "2026-02-27" })).toBeNull();
    expect(fieldsProblem("unsupported", { title: "x", body: "", dueDate: null })).toBe("This action can no longer be edited.");
  });

  it("builds params, keeping what the page does not edit", () => {
    const before = { type: "task.create" as const, task: { title: "Old", detail: "", assigneeHint: "Devon", regarding: { kind: "matter" as const, name: "Brightline" } } };
    expect(paramsFromFields("task", { title: " New ", body: " Body ", dueDate: "2026-11-06" }, before)).toEqual({
      type: "task.create", task: { title: "New", detail: "Body", dueDate: "2026-11-06", assigneeHint: "Devon", regarding: { kind: "matter", name: "Brightline" } },
    });
    expect(paramsFromFields("note", { title: "N", body: "B", dueDate: "2026-11-06" }, null)).toEqual({ type: "note.log", note: { subject: "N", body: "B" } });
  });

  it("says what may be done, and that deleting a ran action keeps the LANA record", () => {
    expect(actionPermissions({ kind: "task", status: "resolved", deleted: false })).toEqual({ isEditable: true, canDelete: true, canRestore: false, deleteNote: null });
    expect(actionPermissions({ kind: "task", status: "confirmed", deleted: false }).canDelete).toBe(false);
    expect(actionPermissions({ kind: "note", status: "executed", deleted: false })).toEqual({
      isEditable: false, canDelete: true, canRestore: false, deleteNote: "This action already ran. Deleting it here does not remove the note from LANA.",
    });
    expect(actionPermissions({ kind: "task", status: "resolved", deleted: true })).toMatchObject({ isEditable: false, canDelete: false, canRestore: true });
    expect(actionPermissions({ kind: "unsupported", status: "transferred", deleted: false }).isEditable).toBe(false);
  });

  it("words the run button, the matter block and the origin", () => {
    expect(runTitleOf("task", "00042 Acme Logistics")).toBe("Create task on 00042 Acme Logistics");
    expect(runTitleOf("note", null)).toBe("Add note");
    expect(matterBlockReason("task", false)).toBe("Choose the matter for this task.");
    expect(matterBlockReason("email", false)).toBeNull();
    expect(originLabelOf("manual", "Weekly review")).toBe("Added by you");
    expect(originLabelOf("meeting", "Weekly review")).toBe("From Weekly review");
    expect(originLabelOf("meeting", null)).toBe("From a meeting");
  });
});

describe("Display titles", () => {
  it("shows a newer type's own title, else a plain label, never the dotted key", () => {
    const own = { type: "unsupported", rawType: "calendar.event.create", raw: { title: " Call with Victor ", starts_on: "2026-11-13" } } as const;
    expect(displayTitleOf(own)).toBe("Call with Victor");
    expect(titleOf(own)).toBe("calendar.event.create");
    expect(displayTitleOf({ type: "unsupported", rawType: "calendar.event.create", raw: { title: "  " } })).toBe("Calendar event");
    expect(displayTitleOf({ type: "unsupported", rawType: "calendar.event.create", raw: null })).toBe("Calendar event");
    expect(displayTitleOf({ type: "unsupported", rawType: "time_entry.log", raw: [] })).toBe("Time entry");
    expect(displayTitleOf({ type: "unsupported", rawType: "docketEntry.create", raw: { subject: "Docket it" } })).toBe("Docket it");
    expect(displayTitleOf({ type: "task.create", task: { title: "Send", detail: "" } })).toBe("Send");
  });

  it("reads the body search covers, and none for a newer type", () => {
    expect(bodyOf({ type: "task.create", task: { title: "Send", detail: "By Friday" } })).toBe("By Friday");
    expect(bodyOf({ type: "unsupported", rawType: "calendar.event.create", raw: { title: "Call" } })).toBe("");
  });

  it("labels any wire type in plain words", () => {
    expect(unsupportedTypeLabel("calendar.event.create")).toBe("Calendar event");
    expect(unsupportedTypeLabel("docketEntry.create")).toBe("Docket entry");
    expect(unsupportedTypeLabel("billing")).toBe("Billing");
    expect(unsupportedTypeLabel("..")).toBe("Newer action");
    expect(unsupportedTypeLabel("")).toBe("Newer action");
    expect(unsupportedTypeLabel("calendar.event.create")).not.toContain(".");
  });
});
