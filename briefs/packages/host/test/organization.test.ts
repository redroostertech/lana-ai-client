import { describe, expect, it } from "vitest";
import { organizationLabel, organizationText, UNNAMED_ORGANIZATION } from "../src/shared/organization.js";

describe("organization label", () => {
  it("shows the name with the Organization ID, never a host", () => {
    expect(organizationLabel({ organizationID: "mwestbrooks", organizationName: "Michael Westbrooks" })).toEqual({ name: "Michael Westbrooks", id: "mwestbrooks" });
    expect(organizationText({ organizationID: "mwestbrooks", organizationName: "Michael Westbrooks" })).toBe("Michael Westbrooks (mwestbrooks)");
  });

  it("shows the id alone when there is no name, and the name alone when they match or there is no id", () => {
    expect(organizationText({ organizationID: "mwestbrooks", organizationName: null })).toBe("mwestbrooks");
    expect(organizationText({ organizationID: "acme", organizationName: "acme" })).toBe("acme");
    expect(organizationText({ organizationID: "", organizationName: "Harlow Reyes LLP" })).toBe("Harlow Reyes LLP");
    expect(organizationText({ organizationID: null, organizationName: " " })).toBe(UNNAMED_ORGANIZATION);
  });
});
