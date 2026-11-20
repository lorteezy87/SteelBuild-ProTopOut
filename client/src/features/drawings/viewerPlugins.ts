import { modelViewerPlugin } from "@/features/model/viewerPlugin";
import type { ViewerPlugin } from "./viewer/plugin";

/** Tabs other modules add to the sheet viewer: the framing model's Framing tab (review read pieces over the drawing). */
export const VIEWER_PLUGINS: ViewerPlugin[] = [modelViewerPlugin];
