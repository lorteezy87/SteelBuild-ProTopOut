import { EmptyState } from "./Layout";

/** Temporary page body used while a screen is being built. */
export function Placeholder({ name }: { name: string }) {
  return <EmptyState title={name} body="This screen is being built." />;
}
