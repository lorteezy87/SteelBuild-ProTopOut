import { randomUUID } from "node:crypto";

/** Crew members are `users` rows that can never sign in: role "user", access "passive", no email login. */
export type CrewInput = {
  name: string;
  title?: string | null;
  phone?: string | null;
  jobRoleId?: number | null;
  costRate?: number | null;
  billRate?: number | null;
  calendarId?: number | null;
  isActive?: boolean;
};

const EDITABLE = ["name", "title", "phone", "jobRoleId", "costRate", "billRate", "calendarId", "isActive"] as const;

export function crewInsertValues(input: CrewInput) {
  return {
    openId: `crew:${randomUUID()}`,
    name: input.name,
    email: null,
    loginMethod: null,
    role: "user" as const,
    accessType: "passive",
    title: input.title ?? null,
    phone: input.phone ?? null,
    jobRoleId: input.jobRoleId ?? null,
    costRate: input.costRate ?? null,
    billRate: input.billRate ?? null,
    calendarId: input.calendarId ?? null,
    isActive: input.isActive ?? true,
  };
}

/** Only crew fields pass through; the owner's own record is edited under Account, never here. */
export function crewUpdateSet(input: Partial<CrewInput>, target?: { role: string }): Partial<CrewInput> {
  if (target?.role === "admin") throw new Error("The owner is managed under Account");
  const out: Partial<CrewInput> = {};
  for (const k of EDITABLE) if ((input as Record<string, unknown>)[k] !== undefined) (out as Record<string, unknown>)[k] = (input as Record<string, unknown>)[k];
  return out;
}
