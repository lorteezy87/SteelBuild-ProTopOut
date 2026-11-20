import { useLocation } from "wouter";
import ModelTab from "@/features/model/ModelTab";
import { useJob } from "./JobContext";

/** Job tab: framing read from the drawings — pieces, lift weights, 3D. Sheets open in the Drawings tab's viewer. */
export default function Model() {
  const { projectId } = useJob();
  const [, navigate] = useLocation();
  return (
    <ModelTab
      projectId={projectId}
      openSheet={(sheetId, opts) => {
        const q = new URLSearchParams({ view: String(sheetId) });
        if (opts?.rev != null) q.set("rev", String(opts.rev));
        if (opts?.tab) q.set("tab", opts.tab);
        navigate(`/jobs/${projectId}/drawings?${q.toString()}`);
      }}
    />
  );
}
