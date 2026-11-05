import type { Intent } from "../intent/intent.js";
import type { IntentStatus } from "../intent/intentStatus.js";
import { regardingOf, titleOf } from "../intent/params.js";
import type { IntentEvent, StoredIntent } from "../store/types.js";
import type { Passage } from "./passage.js";

const EXECUTOR_KEY = "executor";

function kindLabel(intent: Intent): string {
  switch (intent.params.type) {
    case "note.log":
      return "Note";
    case "task.create":
      return "Task";
    case "email.draft":
      return "Email";
    case "unsupported":
      return "Action";
  }
}

function executedPhrase(executor: string | undefined): string {
  switch (executor) {
    case "clio.note":
      return "logged in Clio";
    case "clio.task":
      return "created in Clio";
    case "graph.draft":
      return "drafted in Outlook, not sent";
    default:
      return "carried out";
  }
}

function statusText(status: IntentStatus, executor: string | undefined): string {
  switch (status) {
    case "proposed":
    case "transferred":
    case "resolved":
      return "waiting for review on this computer";
    case "confirmed":
      return "confirmed, not yet carried out";
    case "executed":
      return executedPhrase(executor);
    case "failed":
      return "failed, can be retried";
    case "dismissed":
      return "dismissed, nothing was sent";
    case "undone":
      return "undone, removed again";
  }
}

/**
 * One plain sentence per proposed action describing what happened to it on this
 * computer, so Ask can answer "Did we send the Acme letter?" (Swift
 * `ActionHistorySummary`, NotesMac). For example "Task 'Prepare Solberg outline' regarding
 * Pemberton: proposed Nov 1, confirmed Nov 2, created in Clio, undone Nov 3. Status now:
 * undone, removed again." Held in memory only.
 */
export function actionHistoryText(intent: Intent, events: readonly IntentEvent[], timeZone?: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(timeZone === undefined ? {} : { timeZone }) });
  const steps: string[] = [];
  let lastDay: string | undefined;
  const add = (step: string, at: Date): void => {
    const day = formatter.format(at);
    steps.push(day === lastDay ? step : `${step} ${day}`);
    lastDay = day;
  };
  add("proposed", intent.createdAt);
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    switch (event.to) {
      case "confirmed":
        add("confirmed", event.at);
        break;
      case "executed":
        add(executedPhrase(event.detail[EXECUTOR_KEY]), event.at);
        break;
      case "failed":
        add("failed", event.at);
        break;
      case "dismissed":
        add("dismissed", event.at);
        break;
      case "undone":
        add("undone", event.at);
        break;
      default:
        break;
    }
  }
  const regarding = regardingOf(intent.params);
  const executor = [...events].reverse().find((event) => event.to === "executed")?.detail[EXECUTOR_KEY];
  return `${kindLabel(intent)} '${titleOf(intent.params)}'${regarding === undefined ? "" : ` regarding ${regarding.name}`}: ${steps.join(", ")}. Status now: ${statusText(intent.status, executor)}.`;
}

/** A citable passage for the action's history, pointing at its evidence span. */
export function actionHistoryPassage(stored: StoredIntent, events: readonly IntentEvent[], meetingTitle: string, meetingDate: Date, timeZone?: string): Passage {
  const intent = stored.intent;
  const start = intent.evidence.length === 0 ? 0 : Math.min(...intent.evidence.map((evidence) => evidence.tStart));
  const end = intent.evidence.length === 0 ? start : Math.max(...intent.evidence.map((evidence) => evidence.tEnd));
  return {
    id: `${intent.meetingID}#history-${intent.id}`, meetingID: intent.meetingID, meetingTitle, meetingDate,
    kind: "action", start, end, speakers: [], text: actionHistoryText(intent, events, timeZone),
  };
}
