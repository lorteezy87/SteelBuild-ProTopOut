import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { Wordmark } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import "@/styles/print.css";

/** Letter-size document frame: org, job, title; the browser's Print → Save as PDF makes the file. */
export function PrintShell({ title, subtitle, projectId, landscape, children }: { title: string; subtitle?: ReactNode; projectId?: number | null; landscape?: boolean; children: ReactNode }) {
  const { ref } = useRefData();
  const job = trpc.projects.get.useQuery({ id: projectId ?? 0 }, { enabled: !!projectId });
  const p = job.data?.project;
  const org = (ref?.org as { name?: string } | undefined)?.name;
  return (
    <div className="min-h-dvh bg-white">
      {landscape && <style>{"@page { size: letter landscape; }"}</style>}
      <div className="tp-no-print sticky top-0 z-10 flex items-center gap-2 border-b bg-white px-4 py-2">
        <span className="text-sm text-neutral-600">{title}</span>
        <Button size="sm" className="ml-auto" onClick={() => window.print()}>
          <Printer className="size-3.5" /> Print / Save PDF
        </Button>
      </div>
      <div className={`tp-print ${landscape ? "landscape" : ""}`}>
        <header className="mb-4 flex items-start gap-4 border-b-2 border-black pb-2">
          <div>
            <div className="text-[15px] font-bold">{org || "SteelBuild Pro TopOut"}</div>
            {p && (
              <div className="text-[12px]">
                Job <span className="font-mono">{p.code}</span> · {p.name}
              </div>
            )}
          </div>
          <div className="ml-auto text-right">
            <div className="text-[16px] font-bold uppercase tracking-wide">{title}</div>
            {subtitle && <div className="text-[12px]">{subtitle}</div>}
          </div>
        </header>
        {children}
        <footer className="mt-6 flex items-center gap-2 border-t pt-2 text-[10px] text-neutral-500">
          <Wordmark size="sm" />
          <span className="ml-auto">Printed {new Date().toLocaleString("en-US")}</span>
        </footer>
      </div>
    </div>
  );
}
