import React, { useState, useEffect } from "react";
import "./App.css";
import { invoke, isTauri, convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import type { PhotoFile } from "./types/photo-file";

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "1rem",
  background: "#333",
  color: "#fff",
  justifyContent: "space-between",
};

const mainStyle: React.CSSProperties = {
  maxWidth: 900,
  margin: "2rem auto",
  padding: "2rem",
  background: "#222",
  borderRadius: "8px",
  color: "#fff",
};

const fileListStyle: React.CSSProperties = {
  maxHeight: 400,
  overflowY: "auto",
  background: "#191919",
  borderRadius: "5px",
  marginTop: 20,
  padding: 10,
  fontFamily: "monospace",
  fontSize: 14,
};

type ScanProgress = {
  scanned: number;
  matched: number;
  currentPath: string;
};

function Thumb({ path, name, extension }: { path: string; name: string; extension: string }) {
  const [failed, setFailed] = useState(false);
  const src = convertFileSrc(path);

  if (failed) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#888",
          fontSize: 12,
          textAlign: "center",
          padding: 8,
          background: "#0f0f0f",
        }}
      >
        Preview not available
        <br />
        <b>{extension?.toUpperCase()}</b>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
      onError={() => {
        setFailed(true);
        // For diagnosis
        console.warn("Thumbnail preview failed:", src, path, extension);
      }}
    />
  );
}

function App() {
  const [folderPath, setFolderPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<PhotoFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null); // for info/success message
  const [progress, setProgress] = useState<ScanProgress | null>(null);

  // Utility: build contentHash->PhotoFile[] mapping
  const groupByContentHash = (list: PhotoFile[]) => {
    const groups = new Map<string, PhotoFile[]>();
    for (const img of list) {
      if (!img.contentHash) continue;
      if (!groups.has(img.contentHash)) groups.set(img.contentHash, []);
      groups.get(img.contentHash)!.push(img);
    }
    return groups;
  };
  const hashGroups = groupByContentHash(images);

useEffect(() => {
  if (!isTauri()) return;

  const unlistenPromise = listen<ScanProgress>("scan://progress", (event) => {
    setProgress(event.payload);
  });

  return () => {
    unlistenPromise.then((unlisten) => unlisten());
  };
}, []);



const ensureTauri = () => {
  if (!isTauri()) {
    setError("Not running inside Tauri. Start the app via Tauri dev (not just Vite).");
    return false;
  }
  return true;
};

  const handleChooseFolder = async () => {
    setError(null);
    setImages([]);
    setFolderPath("");
     if (!ensureTauri()) return;
    try {
      const path = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose a folder to scan for images",
      }) as string | null;

      if (path) {
        setFolderPath(path);
        await scanFolder(path);
      }
      if (!path) {
        setError("No folder was selected.");
      }
    } catch (err: any) {
      setError("Failed to open folder picker. " + (err?.message || JSON.stringify(err)));
    }
  };

  async function scanFolder(path: string) {
    setLoading(true);
    setError(null);
    setImages([]);
    setProgress(null);

    try {
      let photos: PhotoFile[] = await invoke("scan_folder", {
        folderPath: path,
      });
      // Sort by createdAt descending
      photos = photos.slice().sort((a, b) => b.createdAt - a.createdAt);
      setImages(photos);
      setSelected(new Set());
    } catch (err: any) {
      setError(typeof err === "string" ? err : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteSelected() {
    setError(null);
    setInfo(null);
    if (selected.size === 0) return;
    if (!isTauri()) {
      setError("Delete is only supported inside the Tauri app.");
      return;
    }
    // Gather selected paths
    const paths = Array.from(selected);
    // Confirm destructive action
    if (!window.confirm(`Delete ${paths.length} selected files?\nFiles may be moved to Trash if supported, or else permanently deleted.`)) {
      return;
    }
    try {
      await invoke("delete_files", { paths });
      // Remove deleted images from list and clear selection
      setImages((prev) => prev.filter((img) => !selected.has(img.path)));
      setSelected(new Set());
      setInfo("Deleted " + paths.length + " file(s)");
    } catch (err: any) {
      setError(typeof err === "string" ? err : "Delete failed.");
    }
  }

  return (
    <div>
      <div style={toolbarStyle}>
        <div style={{ fontWeight: "bold", fontSize: 22 }}>
          Memora
        </div>
        <div>
          <button onClick={handleChooseFolder} style={{
            background: "#70ff7c",
            color: "#222",
            padding: "0.7em 1.3em",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 17,
            marginRight: 10,
          }}>
            Choose Folder
          </button>
          <button
            style={{
              background: selected.size > 0 ? "#ff3169" : "#868686",
              color: "#fff",
              padding: "0.7em 1.2em",
              border: "none",
              borderRadius: 5,
              cursor: selected.size > 0 ? "pointer" : "not-allowed",
              fontWeight: 600,
              fontSize: 17,
              opacity: selected.size > 0 ? 1 : 0.6,
              pointerEvents: selected.size > 0 ? "auto" : "none",
              transition: "background 0.2s",
            }}
            disabled={selected.size === 0}
            onClick={handleDeleteSelected}
            title={selected.size ? "Delete Selected Files (tries Trash first)" : "Select images to enable delete"}
          >
            Delete Selected
          </button>
        </div>
      </div>

      <div style={mainStyle}>
        <h2>Scan for Images</h2>
        {folderPath && (
          <div style={{
            color: "#70ff7c",
            wordBreak: "break-all",
            marginBottom: 16,
            fontWeight: 500,
            fontSize: 15,
          }}>
            <strong>Selected Folder:</strong> {folderPath}
          </div>
        )}

        {loading && (
          <div style={{ margin: "2em 0", color: "#6cf", fontSize: 16 }}>
            <span className="loader" />
            Scanning folder for images...
            {progress && (
              <div style={{ marginTop: 10 }}>
                <div>Scanned files: {progress.scanned}</div>
                <div>Images found: {progress.matched}</div>
                <div>
                  Current:{" "}
                  <span style={{ color: "#43c1ff" }}>
                    {progress.currentPath === "<done>" ? "(finishing...)" : progress.currentPath}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ color: "#ff5656", marginTop: 10 }}>
            {error}
          </div>
        )}
        {info && (
          <div style={{ color: "#41ff96", marginTop: 10 }}>
            {info}
          </div>
        )}

        {!loading && images.length > 0 && (
          <div>
            <div style={{ marginBottom: 14, fontSize: 17 }}>
              <strong>{images.length}</strong> images found.
              <span style={{ marginLeft: 16, fontSize: 14, color: "#68f" }}>
                {selected.size} selected
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: "18px",
                background: "#181818",
                padding: "14px",
                borderRadius: "10px",
              }}
            >
              {images.map((img) => {
                const isSelected = selected.has(img.path);
                const thumbSrc = convertFileSrc(img.path);
                // Detect duplicates
                const group = img.contentHash && hashGroups.get(img.contentHash);
                const isDuplicate = group && group.length > 1;
                return (
                  <div
                    key={img.path}
                    style={{
                      border: isSelected ? "3px solid #70ff7c" : "2.5px solid #444",
                      padding: 8,
                      borderRadius: 8,
                      background: "#222",
                      boxShadow: isSelected
                        ? "0 0 0 2px #70ff7c55"
                        : "0 1.5px 8px #0004",
                      position: "relative",
                      cursor: "pointer",
                      userSelect: "none",
                      transition: "border-color 0.14s, box-shadow 0.15s",
                    }}
                    onClick={() => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(img.path)) next.delete(img.path);
                        else next.add(img.path);
                        return next;
                      });
                    }}
                  >
                    {/* Duplicate group badge */}
                    {isDuplicate && (
                      <div
                        style={{
                          position: "absolute",
                          top: 2,
                          right: 2,
                          background: "#ff3846",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: 12,
                          padding: "2px 9px",
                          borderRadius: 16,
                          boxShadow: "0 1.5px 6px #0005",
                          zIndex: 10,
                        }}
                        title={`${group!.length} duplicates in library`}
                      >
                        x{group!.length}
                      </div>
                    )}
                    <div
                      style={{
                        aspectRatio: "1 / 1",
                        borderRadius: 6,
                        overflow: "hidden",
                        background: "#0f0f0f",
                        marginBottom: 7,
                        border: isSelected ? "2px solid #70ff7c" : "1.5px solid #333",
                        transition: "border-color 0.13s",
                      }}
                    >
                      <Thumb path={img.path} name={img.name} extension={img.extension} />
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#eee",
                        fontWeight: 500,
                        marginBottom: 2,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        width: "100%",
                      }}
                      title={img.name}
                    >
                      {img.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#96d8ff",
                        fontWeight: 400,
                        marginBottom: 1,
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        width: "100%",
                      }}
                    >
                      {img.createdAt
                        ? `Created: ${new Date(img.createdAt).toLocaleString()}`
                        : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "#aaa" }}>
                      {img.sizeBytes} bytes
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && !error && folderPath && images.length === 0 && (
          <div style={{ color: "#ffaa44", marginTop: 16 }}>
            No images found in this folder.
          </div>
        )}
      </div>
    </div>
  );
}

export default App;