import { Copy, FileText, PanelRightClose } from "lucide-react";
import type { Artifact } from "../canvas/artifacts";

interface CanvasPanelProps {
  artifact: Artifact | null;
  onClose: () => void;
}

export function CanvasPanel({ artifact, onClose }: CanvasPanelProps) {
  return (
    <aside className="canvas-panel">
      <header>
        <div>
          <h2>Canvas</h2>
          <p>{artifact ? `${artifact.kind} artifact` : "No active artifact"}</p>
        </div>
        <div className="icon-actions">
          <button type="button" aria-label="Copy artifact">
            <Copy size={15} />
          </button>
          <button type="button" aria-label="Close canvas" onClick={onClose}>
            <PanelRightClose size={15} />
          </button>
        </div>
      </header>

      {artifact ? (
        <div className="artifact">
          <div className="artifact-title">
            <FileText size={16} />
            <strong>{artifact.title}</strong>
          </div>
          <pre>{artifact.source}</pre>
        </div>
      ) : (
        <div className="empty-canvas">
          <FileText size={28} />
          <h3>Artifacts will open here</h3>
          <p>Markdown, code, HTML, SVG, Mermaid, and text previews will live in this split view.</p>
        </div>
      )}
    </aside>
  );
}
