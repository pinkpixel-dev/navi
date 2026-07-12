import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  FileText,
  Maximize2,
  Minimize2,
  PanelRightClose,
} from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import type { Artifact, ArtifactGroup } from "../canvas/artifacts";
import { copyArtifactSource, downloadArtifact, downloadArtifactsZip } from "../canvas/download";

mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });

interface CanvasPanelProps {
  groups: ArtifactGroup[];
  isExpanded: boolean;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onToggleExpanded: () => void;
  onClose: () => void;
}

function MarkdownView({ source }: { source: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { async: false }) as string), [source]);
  return <div className="artifact-body artifact-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

function CodeView({ source, language }: { source: string; language?: string }) {
  return (
    <div className="artifact-body">
      {language ? <span className="artifact-language">{language}</span> : null}
      <pre className="artifact-code">
        <code>{source}</code>
      </pre>
    </div>
  );
}

function HtmlView({ source }: { source: string }) {
  return <iframe className="artifact-frame" sandbox="allow-scripts" srcDoc={source} title="HTML preview" />;
}

function SvgView({ source }: { source: string }) {
  const dataUri = useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(source)}`, [source]);
  return (
    <div className="artifact-body artifact-image-wrap">
      <img className="artifact-image" src={dataUri} alt="SVG artifact preview" />
    </div>
  );
}

function ImageView({ source, title }: { source: string; title: string }) {
  return (
    <div className="artifact-body artifact-image-wrap">
      <img className="artifact-image" src={source} alt={title} />
    </div>
  );
}

function MermaidView({ source }: { source: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const renderId = `mermaid-${Math.random().toString(36).slice(2)}`;

    mermaid
      .render(renderId, source)
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      })
      .catch((renderError: unknown) => {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : "Could not render this diagram.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <div className="artifact-body">
        <p className="artifact-error">{error}</p>
        <pre className="artifact-code">
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  return <div className="artifact-body artifact-image-wrap" ref={containerRef} />;
}

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  switch (artifact.kind) {
    case "markdown":
      return <MarkdownView source={artifact.source} />;
    case "html":
      return <HtmlView source={artifact.source} />;
    case "svg":
      return <SvgView source={artifact.source} />;
    case "image":
      return <ImageView source={artifact.source} title={artifact.title} />;
    case "mermaid":
      return <MermaidView source={artifact.source} />;
    default:
      return <CodeView source={artifact.source} language={artifact.language} />;
  }
}

export function CanvasPanel({ groups, isExpanded, onResizeStart, onToggleExpanded, onClose }: CanvasPanelProps) {
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [revisionIndexByGroup, setRevisionIndexByGroup] = useState<Record<string, number>>({});
  const [view, setView] = useState<"preview" | "raw">("preview");
  const [status, setStatus] = useState<string | null>(null);
  const lastArtifactId = useRef<string | null>(null);

  const latestArtifactId = groups.at(-1)?.revisions.at(-1)?.id ?? null;

  useEffect(() => {
    if (latestArtifactId && latestArtifactId !== lastArtifactId.current) {
      const latestGroup = groups.at(-1);
      if (latestGroup) {
        setSelectedGroupKey(latestGroup.key);
        setRevisionIndexByGroup((current) => ({ ...current, [latestGroup.key]: latestGroup.revisions.length - 1 }));
      }
    }
    lastArtifactId.current = latestArtifactId;
  }, [groups, latestArtifactId]);

  const selectedGroup = groups.find((group) => group.key === selectedGroupKey) ?? groups.at(-1) ?? null;
  const revisionCount = selectedGroup?.revisions.length ?? 0;
  const revisionIndex = Math.min(
    revisionIndexByGroup[selectedGroup?.key ?? ""] ?? Math.max(0, revisionCount - 1),
    Math.max(0, revisionCount - 1),
  );
  const artifact = selectedGroup?.revisions[revisionIndex] ?? null;
  const allArtifacts = useMemo(() => groups.flatMap((group) => group.revisions), [groups]);

  const flashStatus = (text: string) => {
    setStatus(text);
    window.setTimeout(() => setStatus(null), 2500);
  };

  const setRevisionIndex = (index: number) => {
    if (!selectedGroup) {
      return;
    }
    const clamped = Math.max(0, Math.min(index, selectedGroup.revisions.length - 1));
    setRevisionIndexByGroup((current) => ({ ...current, [selectedGroup.key]: clamped }));
  };

  const handleCopy = async () => {
    if (!artifact) {
      return;
    }
    try {
      await copyArtifactSource(artifact);
      flashStatus("Copied to clipboard.");
    } catch {
      flashStatus("Could not copy this artifact.");
    }
  };

  const handleDownload = async () => {
    if (!artifact) {
      return;
    }
    try {
      const saved = await downloadArtifact(artifact);
      if (saved) {
        flashStatus("Artifact saved.");
      }
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : "Could not save this artifact.");
    }
  };

  const handleDownloadZip = async () => {
    if (!allArtifacts.length) {
      return;
    }
    try {
      const saved = await downloadArtifactsZip(allArtifacts, "navi-artifacts.zip");
      if (saved) {
        flashStatus("Artifacts zip saved.");
      }
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : "Could not build the zip.");
    }
  };

  return (
    <aside className="canvas-panel">
      <div className="canvas-resizer" role="separator" aria-label="Resize canvas" onPointerDown={onResizeStart} />
      <header>
        <div>
          <h2>Canvas</h2>
          <p>{status ?? (artifact ? `${artifact.kind} artifact` : "No active artifact")}</p>
        </div>
        <div className="icon-actions">
          {artifact ? (
            <>
              <button
                type="button"
                aria-label={view === "preview" ? "View raw source" : "View preview"}
                title={view === "preview" ? "View raw source" : "View preview"}
                onClick={() => setView((current) => (current === "preview" ? "raw" : "preview"))}
              >
                {view === "preview" ? <Code2 size={15} /> : <Eye size={15} />}
              </button>
              <button type="button" aria-label="Copy artifact" title="Copy artifact" onClick={handleCopy}>
                <Copy size={15} />
              </button>
              <button type="button" aria-label="Download artifact" title="Download artifact" onClick={handleDownload}>
                <Download size={15} />
              </button>
              <button
                type="button"
                aria-label="Download all artifacts as zip"
                title="Download all artifacts as zip"
                onClick={handleDownloadZip}
              >
                <Archive size={15} />
              </button>
            </>
          ) : null}
          <button
            type="button"
            aria-label={isExpanded ? "Restore canvas size" : "Expand canvas"}
            title={isExpanded ? "Restore canvas size" : "Expand canvas"}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button type="button" aria-label="Close canvas" onClick={onClose}>
            <PanelRightClose size={15} />
          </button>
        </div>
      </header>

      {artifact && selectedGroup ? (
        <div className="artifact">
          <div className="artifact-title">
            <FileText size={16} />
            {groups.length > 1 ? (
              <select
                aria-label="Active artifact"
                value={selectedGroup.key}
                onChange={(event) => setSelectedGroupKey(event.target.value)}
              >
                {groups.map((group) => (
                  <option key={group.key} value={group.key}>
                    {group.title}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{artifact.title}</strong>
            )}
            {revisionCount > 1 ? (
              <span className="artifact-revisions">
                <button
                  type="button"
                  aria-label="Previous revision"
                  disabled={revisionIndex === 0}
                  onClick={() => setRevisionIndex(revisionIndex - 1)}
                >
                  <ChevronLeft size={14} />
                </button>
                <small>
                  v{revisionIndex + 1} of {revisionCount}
                </small>
                <button
                  type="button"
                  aria-label="Next revision"
                  disabled={revisionIndex === revisionCount - 1}
                  onClick={() => setRevisionIndex(revisionIndex + 1)}
                >
                  <ChevronRight size={14} />
                </button>
              </span>
            ) : null}
          </div>
          {view === "preview" ? (
            <ArtifactPreview artifact={artifact} />
          ) : (
            <CodeView source={artifact.source} language={artifact.language} />
          )}
        </div>
      ) : (
        <div className="empty-canvas">
          <FileText size={28} />
          <h3>Artifacts will open here</h3>
          <p>Markdown, code, HTML, SVG, Mermaid, and image previews will live in this split view.</p>
        </div>
      )}
    </aside>
  );
}
