import React, { useState, useEffect } from "react";
import "./App.css";
import { invoke, isTauri } from "@tauri-apps/api/core";
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

function App() {
  const [folderPath, setFolderPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<PhotoFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);

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
      const photos: PhotoFile[] = await invoke("scan_folder", {
        folderPath: path,
      });
      setImages(photos);
    } catch (err: any) {
      setError(typeof err === "string" ? err : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={toolbarStyle}>
        <div style={{ fontWeight: "bold", fontSize: 22 }}>
          Memora
        </div>
        <button onClick={handleChooseFolder} style={{
          background: "#70ff7c",
          color: "#222",
          padding: "0.7em 1.3em",
          border: "none",
          borderRadius: 5,
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 17,
        }}>
          Choose Folder
        </button>
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

        {!loading && images.length > 0 && (
          <div>
            <div style={{ marginBottom: 14, fontSize: 17 }}>
              <strong>{images.length}</strong> images found.
            </div>
            <div style={fileListStyle}>
              {images.map((img, idx) => (
                <div key={img.path + idx} style={{ marginBottom: 8 }}>
                  <div>
                    <strong>{img.name}</strong>
                  </div>
                  <div>Path: {img.path}</div>
                  <div>Extension: {img.extension}</div>
                  <div>Size: {img.sizeBytes} bytes</div>
                  <div>Created: {img.createdAt}</div>
                  <div>Modified: {img.modifiedAt}</div>
                </div>
              ))}
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