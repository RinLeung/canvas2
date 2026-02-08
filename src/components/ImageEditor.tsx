import React, { useRef, useState, useEffect, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Transformer, Rect } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type Konva from "konva";

// Constants
const ASPECT_RATIOS: Record<string, number> = {
  "1:1": 1,
  "1:2": 0.5,
  "2:3": 2 / 3,
  "3:4": 0.75,
  "4:5": 0.8,
  "16:9": 16 / 9,
  "3:2": 1.5,
  "4:3": 4 / 3
};

const DEFAULT_ASPECT = "1:1";
const MIN_SIZE = 10;
const ZOOM_SCALE = 1.05;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const DEFAULT_SELECTION_WIDTH = 400;
const PADDING = 40;

export default function ImageEditor() {
  // Konva refs with proper typing
  const stageRef = useRef<Konva.Stage>(null);
  const imageNodeRef = useRef<Konva.Image>(null);
  const rectRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);
  
  // DOM refs
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAreaRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Pan state
  const panLast = useRef<{ x: number; y: number } | null>(null);
  const dragCounter = useRef(0);

  // Cleanup stage on unmount
  useEffect(() => {
    return () => {
      try {
        stageRef.current?.destroy();
      } catch (e) {
        // ignore cleanup errors
      }
    };
  }, []);

  // Image file state
  const [fileSrc, setFileSrc] = useState<string | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [dpiInfo, setDpiInfo] = useState<string>("unknown");
  const [isClient, setIsClient] = useState(false);

  // Selection and transform state
  const [selection, setSelection] = useState({ x: 50, y: 50, width: 300, height: 300 });
  const [keepRatio, setKeepRatio] = useState(false);
  const [aspect, setAspect] = useState<string>(DEFAULT_ASPECT);

  // Zoom and pan state
  const [imageScale, setImageScale] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  // Stage dimensions
  const [stageDimensions, setStageDimensions] = useState({ width: 800, height: 600 });
  const stageWidth = stageDimensions.width;
  const stageHeight = stageDimensions.height;

  useEffect(() => setIsClient(true), []);

  // Image geometry calculations
  const baseDisplayWidth = stageWidth;
  const displayedImageWidth = baseDisplayWidth * imageScale;
  const displayedImageHeight = imgElement
    ? (imgElement.naturalHeight * displayedImageWidth) / imgElement.naturalWidth
    : stageHeight;

  const baseX = (stageWidth - displayedImageWidth) / 2;
  const baseY = (stageHeight - displayedImageHeight) / 2;
  const imageX = baseX + imageOffset.x;
  const imageY = baseY + imageOffset.y;

  // File handling
  const handleFileObject = useCallback((f: File) => {
    if (!f) return;
    setLastFile(f);

    // Extract DPI metadata
    f.arrayBuffer()
      .then((buf) => {
        const dv = new DataView(buf);
        const pngDpi = parsePNG_DPI(dv);
        if (pngDpi) {
          setDpiInfo(pngDpi);
          return;
        }
        const jpegDpi = parseJPEG_EXIF_DPI(dv);
        if (jpegDpi) {
          setDpiInfo(jpegDpi);
          return;
        }
        setDpiInfo("unknown");
      })
      .catch(() => setDpiInfo("unknown"));

    // Load image
    const url = URL.createObjectURL(f);
    const img = new window.Image();
    img.src = url;
    img.onload = () => {
      setFileSrc(url);
      setImgElement(img);
      setImageScale(1);
      setImageOffset({ x: 0, y: 0 });
      
      const selectionWidth = Math.min(DEFAULT_SELECTION_WIDTH, stageWidth - PADDING);
      const aspectRatio = ASPECT_RATIOS[aspect] ?? 1;
      const selectionHeight = Math.round(selectionWidth / aspectRatio);

      setSelection({
        x: Math.round((stageWidth - selectionWidth) / 2),
        y: Math.round((stageHeight - selectionHeight) / 2),
        width: selectionWidth,
        height: selectionHeight
      });
    };
  }, [aspect, stageWidth, stageHeight]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFileObject(f);
  };

  // Geometry helpers
  const clampOffset = useCallback(
    (off: { x: number; y: number }) => {
      if (!imgElement) return off;
      
      let minX = stageWidth - displayedImageWidth;
      let maxX = 0;
      let minY = stageHeight - displayedImageHeight;
      let maxY = 0;

      if (displayedImageWidth < stageWidth) {
        minX = maxX = (stageWidth - displayedImageWidth) / 2 - baseX;
      }
      if (displayedImageHeight < stageHeight) {
        minY = maxY = (stageHeight - displayedImageHeight) / 2 - baseY;
      }

      return {
        x: Math.max(minX, Math.min(maxX, off.x)),
        y: Math.max(minY, Math.min(maxY, off.y))
      };
    },
    [imgElement, stageWidth, stageHeight, displayedImageWidth, displayedImageHeight, baseX, baseY]
  );

  const clampSelection = useCallback((sel: typeof selection) => {
    const s = { ...sel };
    if (s.x < 0) s.x = 0;
    if (s.y < 0) s.y = 0;
    if (s.x + s.width > stageWidth) s.x = stageWidth - s.width;
    if (s.y + s.height > stageHeight) s.y = stageHeight - s.height;
    return s;
  }, [stageWidth, stageHeight]);

  // Sync rect node with state
  useEffect(() => {
    if (!rectRef.current) return;
    
    rectRef.current.x(selection.x);
    rectRef.current.y(selection.y);
    rectRef.current.width(selection.width);
    rectRef.current.height(selection.height);
    rectRef.current.getLayer()?.batchDraw();
  }, [selection]);

  // Attach transformer to rect
  useEffect(() => {
    if (!trRef.current || !rectRef.current) return;
    
    trRef.current.nodes([rectRef.current]);
    trRef.current.getLayer()?.batchDraw();
  }, []);

  // Responsive stage dimensions
  useEffect(() => {
    const measureNode = () => panelRef.current ?? containerRef.current;
    let node = measureNode();
    if (!node) return;

    const measure = () => {
      node = measureNode();
      if (!node) return;
      
      const rect = node.getBoundingClientRect();
      const width = Math.max(0, Math.round(rect.width));
      const height = Math.min(window.innerHeight - 300, 600);
      
      setStageDimensions((prev) => {
        if (prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    };

    // Initial measure
    const raf = requestAnimationFrame(measure);

    // Use ResizeObserver if available, fallback to window events
    const ResizeObs = (window as any).ResizeObserver;
    let ro: ResizeObserver | null = null;
    
    if (ResizeObs) {
      ro = new ResizeObs(() => requestAnimationFrame(measure));
      ro?.observe(node);
    } else {
      window.addEventListener("resize", measure);
      window.addEventListener("load", measure);
    }

    return () => {
      cancelAnimationFrame(raf);
      if (ro) {
        ro.disconnect();
      } else {
        window.removeEventListener("resize", measure);
        window.removeEventListener("load", measure);
      }
    };
  }, []);

  // Initialize UIkit upload integration
  useEffect(() => {
    const UIkit = (window as any).UIkit;
    const progressBar = document.getElementById("js-progressbar") as HTMLProgressElement | null;
    if (!UIkit) return;

    UIkit.upload(".js-upload", {
      url: "",
      multiple: false,
      loadStart: (e: any) => {
        if (progressBar) {
          progressBar.removeAttribute("hidden");
          progressBar.max = e.total;
          progressBar.value = e.loaded;
        }
      },
      progress: (e: any) => {
        if (progressBar) {
          progressBar.max = e.total;
          progressBar.value = e.loaded;
        }
      },
      loadEnd: (e: any) => {
        if (progressBar) {
          progressBar.max = e.total;
          progressBar.value = e.loaded;
        }
      },
      completeAll: () => {
        setTimeout(() => {
          if (progressBar) progressBar.setAttribute("hidden", "hidden");
        }, 1000);
        alert("Upload Completed");
      }
    });
  }, []);

  // Apply Konva stylesheet for responsive rendering
  useEffect(() => {
    const styleId = "konva-uikit-style";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.innerHTML = `
      .konvajs-content {
        width: 100% !important;
        height: auto !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      .konvajs-content canvas {
        width: 100% !important;
        height: auto !important;
        display: block !important;
      }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  // Handle transform end - apply scale to width/height
  const handleRectTransformEnd = useCallback(() => {
    if (!rectRef.current) return;

    const node = rectRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    // Reset scale to 1 and update dimensions
    node.scaleX(1);
    node.scaleY(1);

    // Update selection state with new dimensions
    setSelection({
      x: node.x(),
      y: node.y(),
      width: Math.round(node.width() * scaleX),
      height: Math.round(node.height() * scaleY)
    });
  }, []);
  // Export cropped region
  const exportCropped = useCallback(async () => {
    const { x, y, width, height } = selection;
    if (!imgElement) return;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.round(width);
    exportCanvas.height = Math.round(height);
    
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    const sxOnDisplay = x - imageX;
    const syOnDisplay = y - imageY;
    const scaleNat = imgElement.naturalWidth / displayedImageWidth;

    const sx = sxOnDisplay * scaleNat;
    const sy = syOnDisplay * scaleNat;
    const sWidth = width * scaleNat;
    const sHeight = height * scaleNat;

    ctx.drawImage(
      imgElement,
      sx,
      sy,
      sWidth,
      sHeight,
      0,
      0,
      exportCanvas.width,
      exportCanvas.height
    );

    // Convert and upload
    exportCanvas.toBlob(async (blob) => {
      if (!blob) return;

      const formData = new FormData();
      formData.append("image", blob, "crop.png");
      formData.append(
        "metadata",
        JSON.stringify({
          originalWidth: imgElement.naturalWidth,
          originalHeight: imgElement.naturalHeight,
          cropX: Math.round(sx),
          cropY: Math.round(sy),
          cropWidth: Math.round(sWidth),
          cropHeight: Math.round(sHeight)
        })
      );

      try {
        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData
        });

        const result = await response.json();
        if (result.success) {
          alert(`Image uploaded successfully! ID: ${result.id}`);
        } else {
          alert(`Upload failed: ${result.error}`);
        }
      } catch (error) {
        console.error("Upload error:", error);
        alert("Upload failed. Check console for details.");
      }
    }, "image/png");
  }, [selection, imgElement, imageX, imageY, displayedImageWidth]);


  // Stage pan/zoom handlers
  const handleStageMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const clickedOn = e.target;
      // Don't pan if clicking on rect or its children
      if (
        clickedOn === rectRef.current ||
        (clickedOn.getParent && clickedOn.getParent() === rectRef.current)
      ) {
        return;
      }
      setIsPanning(true);
      const pos = stageRef.current?.getPointerPosition();
      if (pos) panLast.current = pos;
    },
    []
  );

  const handleStageMouseMove = useCallback(() => {
    if (!isPanning || !panLast.current || !stageRef.current) return;

    const pos = stageRef.current.getPointerPosition();
    if (!pos) return;

    const dx = pos.x - panLast.current.x;
    const dy = pos.y - panLast.current.y;
    panLast.current = pos;

    setImageOffset((prev) => clampOffset({ x: prev.x + dx, y: prev.y + dy }));
  }, [isPanning, clampOffset]);

  const handleStageMouseUp = useCallback(() => {
    setIsPanning(false);
    panLast.current = null;
  }, []);

  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      if (!imgElement || !stageRef.current) return;

      e.evt.preventDefault();

      const oldScale = imageScale;
      const pointer = stageRef.current.getPointerPosition();
      if (!pointer) return;

      const { x: mouseX, y: mouseY } = pointer;
      const newScale = e.evt.deltaY > 0 ? oldScale / ZOOM_SCALE : oldScale * ZOOM_SCALE;
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));

      // Calculate image point before zoom
      const imagePointBefore = {
        x: (mouseX - baseX - imageOffset.x) / oldScale,
        y: (mouseY - baseY - imageOffset.y) / oldScale
      };

      // Calculate new offset to keep mouse position fixed
      const newOffsetX = mouseX - baseX - imagePointBefore.x * clamped;
      const newOffsetY = mouseY - baseY - imagePointBefore.y * clamped;

      setImageScale(clamped);
      setImageOffset(clampOffset({ x: newOffsetX, y: newOffsetY }));
    },
    [imgElement, imageScale, baseX, baseY, imageOffset, clampOffset]
  );

  // Render everything inside a single uk-container. When client isn't ready show a placeholder inside it.
  return (
    <div ref={containerRef} className="uk-container uk-container-small">
      {!isClient && (
        <div>
          <div className="uk-grid uk-grid-small uk-flex-middle" style={{ marginBottom: 12 }}>
            <div className="uk-width-auto@m uk-margin">
               <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
               <button
                 className="uk-button uk-button-default"
                 type="button"
                 tabIndex={-1}
                 onClick={() => fileInputRef.current?.click()}
               >
                 Choose Image
               </button>
             </div>
            <div className="uk-width-auto@m uk-margin">
               <label className="uk-form-label" style={{ margin: 0 }}>
                 <input className="uk-checkbox" type="checkbox" checked={keepRatio} readOnly />
                 <span style={{ marginLeft: 8 }}>Keep aspect ratio</span>
               </label>
             </div>
            <div className="uk-width-auto@m uk-margin">
               <button className="uk-button uk-button-primary">Export Crop</button>
             </div>
           </div>
          <div className="uk-panel uk-overflow-auto" style={{ border: "1px solid #ccc", background: "#fff", minHeight: stageHeight }} />
        </div>
      )}

      {isClient && (
        <>
          <div className="uk-grid uk-grid-small uk-flex-middle uk-margin-bottom" style={{ marginBottom: 12 }}>
            <div className="uk-width-auto@m ">
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
              <button
                className="uk-button uk-button-default"
                type="button"
                tabIndex={-1}
                onClick={() => fileInputRef.current?.click()}
              >
                Choose Image
              </button>
            </div>

            <div className="uk-width-auto@m uk-margin">
               <label className="uk-form-label" style={{ margin: 0 }}>
                 <input className="uk-checkbox" type="checkbox" checked={keepRatio} onChange={() => setKeepRatio((v) => !v)} />
                 <span style={{ marginLeft: 6 }}>Keep aspect ratio</span>
               </label> 
             </div>

            <div className="uk-width-auto@m uk-margin">
              <label className="uk-form-label uk-flex-center" style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                <span style={{ marginRight: 6 }}>Aspect:</span>
                <select
                  className="uk-select uk-form-width-small"
                  value={aspect}
                  onChange={(e) => {
                    const nextAspect = e.target.value;
                    setAspect(nextAspect);

                    // Update selection to match new aspect ratio
                    const ar = ASPECT_RATIOS[nextAspect] ?? 1;
                    const centerX = selection.x + selection.width / 2;
                    const centerY = selection.y + selection.height / 2;

                    // Keep width, recalculate height
                    let newWidth = selection.width;
                    let newHeight = Math.round(newWidth / ar);

                    // Clamp to stage
                    if (newHeight > stageHeight) {
                      newHeight = stageHeight - PADDING;
                      newWidth = Math.round(newHeight * ar);
                    }
                    if (newWidth > stageWidth) {
                      newWidth = stageWidth - PADDING;
                      newHeight = Math.round(newWidth / ar);
                    }

                    // Recenter
                    const nx = Math.max(0, Math.min(stageWidth - newWidth, Math.round(centerX - newWidth / 2)));
                    const ny = Math.max(0, Math.min(stageHeight - newHeight, Math.round(centerY - newHeight / 2)));

                    setSelection({ x: nx, y: ny, width: newWidth, height: newHeight });
                  }}
                >
                  {Object.keys(ASPECT_RATIOS).map((ratio) => (
                    <option key={ratio}>{ratio}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="uk-width-expand@m uk-width-1-3@m">
              <label className="uk-form-label uk-flex-center" style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                <span>Zoom:</span>
                <input
                  className="uk-range"
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={imageScale}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    const center = { x: stageWidth / 2, y: stageHeight / 2 };
                    const oldScale = imageScale;
                    const imagePointBefore = {
                      x: (center.x - baseX - imageOffset.x) / oldScale,
                      y: (center.y - baseY - imageOffset.y) / oldScale
                    };
                    setImageScale(v);
                    setImageOffset(() =>
                      clampOffset({
                        x: center.x - baseX - imagePointBefore.x * v,
                        y: center.y - baseY - imagePointBefore.y * v
                      })
                    );
                  }}
                  style={{ width: 160 }}
                />
                <input
                  className="uk-input uk-form-width-small"
                  type="number"
                  step="0.01"
                  value={imageScale.toFixed(2)}
                  onChange={(e) => {
                    let v = Number(e.target.value);
                    if (isNaN(v)) v = 1;
                    v = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v));
                    const center = { x: stageWidth / 2, y: stageHeight / 2 };
                    const oldScale = imageScale;
                    const imagePointBefore = {
                      x: (center.x - baseX - imageOffset.x) / oldScale,
                      y: (center.y - baseY - imageOffset.y) / oldScale
                    };
                    setImageScale(v);
                    setImageOffset(() =>
                      clampOffset({
                        x: center.x - baseX - imagePointBefore.x * v,
                        y: center.y - baseY - imagePointBefore.y * v
                      })
                    );
                  }}
                  style={{ width: 64 }}
                />
              </label>
            </div>

            <div className="uk-width-auto@m uk-margin">
              <button
                className="uk-button"
                onClick={() => {
                  setImageScale(1);
                  setImageOffset({ x: 0, y: 0 });

                  const selectionWidth = Math.min(DEFAULT_SELECTION_WIDTH, stageWidth - PADDING);
                  const ar = ASPECT_RATIOS[aspect] ?? 1;
                  const selectionHeight = Math.round(selectionWidth / ar);

                  setSelection({
                    x: Math.round((stageWidth - selectionWidth) / 2),
                    y: Math.round((stageHeight - selectionHeight) / 2),
                    width: selectionWidth,
                    height: selectionHeight
                  });
                }}
              >
                Reset
              </button>
            </div>

            <div className="uk-width-auto@m uk-margin">
               <button className="uk-button uk-button-primary" onClick={exportCropped}>Export Crop</button>
             </div>
          <div className="uk-width-expand@m"> <div className="uk-text-muted" style={{ marginLeft: 12 }}>Tip: drag background to pan, wheel to zoom (or use controls)</div></div>

          <div className="uk-width-expand@m">
            <div style={{ marginLeft: 12 }}>
              <div
                ref={uploadAreaRef}
                className="js-upload uk-placeholder uk-text-center"
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(e) => {
                  e.preventDefault();
                  dragCounter.current += 1;
                  uploadAreaRef.current?.classList.add('uk-dragover');
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  dragCounter.current = Math.max(0, dragCounter.current - 1);
                  if (dragCounter.current === 0) uploadAreaRef.current?.classList.remove('uk-dragover');
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dragCounter.current = 0;
                  uploadAreaRef.current?.classList.remove('uk-dragover');
                  const f = e.dataTransfer?.files?.[0];
                  if (f) handleFileObject(f);
                }}
              >
                 <span data-uk-icon="icon: cloud-upload"></span>
                 <span className="uk-text-middle" style={{ marginLeft: 8 }}>Drop an image here </span>
                 
               </div>
               <progress id="js-progressbar" className="uk-progress" value={0} max={100} hidden></progress>
             </div>        
           </div>
          </div>

          {stageWidth > 0 && stageHeight > 0 && (
             <div
               ref={panelRef}
               className="uk-panel uk-overflow-auto uk-margin-auto"
               style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", overflowX: "hidden" }}
             >
               <Stage
                // use devicePixelRatio for crisp rendering while letting CSS control layout
                pixelRatio={typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1}
                width={stageWidth}
                height={stageHeight}
                ref={stageRef}
                // let the parent (UIKit) control responsive width; keep explicit height in px
                style={{
                  border: "1px solid #ccc",
                  background: "#fff",
                  cursor: isPanning ? "grabbing" : "grab",
                  display: "block",
                  margin: "0 auto",
                  width: "100%",
                  height: `${stageHeight}px`
                }}
                onMouseDown={handleStageMouseDown}
                onMouseMove={handleStageMouseMove}
                onMouseUp={handleStageMouseUp}
                onWheel={handleWheel}
              >
                <Layer>
                  <Rect x={0} y={0} width={stageWidth} height={stageHeight} fill="#f8f8f8" />

                  {fileSrc && imgElement && (
                    <KonvaImage
                      ref={imageNodeRef}
                      x={imageX}
                      y={imageY}
                      image={imgElement}
                      width={displayedImageWidth}
                      height={displayedImageHeight}
                      listening={false}
                    />
                  )}

                  <Rect
                    ref={rectRef}
                    x={selection.x}
                    y={selection.y}
                    width={selection.width}
                    height={selection.height}
                    stroke="rgba(9, 98, 241, 0.9)"
                    strokeWidth={2}
                    dash={[6, 4]}
                    draggable
                    onDragEnd={(e: KonvaEventObject<DragEvent>) => {
                      setSelection(
                        clampSelection({
                          x: e.target.x(),
                          y: e.target.y(),
                          width: selection.width,
                          height: selection.height
                        })
                      );
                    }}
                    onTransformEnd={handleRectTransformEnd}
                  />

                  <Transformer
                    ref={trRef}
                    keepRatio={keepRatio}
                    rotationEnabled={false}
                    enabledAnchors={
                      keepRatio
                        ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                        : [
                            "top-left",
                            "top-center",
                            "top-right",
                            "middle-right",
                            "bottom-right",
                            "bottom-center",
                            "bottom-left",
                            "middle-left"
                          ]
                    }
                    boundBoxFunc={(oldBox, newBox) => {
                      // Prevent resize below minimum
                      if (Math.abs(newBox.width) < MIN_SIZE || Math.abs(newBox.height) < MIN_SIZE) {
                        return oldBox;
                      }

                      // Enforce aspect ratio
                      if (keepRatio) {
                        const ar = ASPECT_RATIOS[aspect] ?? 1;
                        const widthChange = Math.abs(newBox.width - oldBox.width);
                        const heightChange = Math.abs(newBox.height - oldBox.height);

                        if (widthChange > heightChange) {
                          const newHeight = Math.abs(newBox.width) / ar;
                          return {
                            ...newBox,
                            height: newBox.height < 0 ? -newHeight : newHeight
                          };
                        } else {
                          const newWidth = Math.abs(newBox.height) * ar;
                          return {
                            ...newBox,
                            width: newBox.width < 0 ? -newWidth : newWidth
                          };
                        }
                      }

                      return newBox;
                    }}
                  />
                </Layer>
              </Stage>
              {/* Image info panel */}
              <div className="uk-margin-top" style={{ padding: 12 }}>
                {imgElement && (
                  <div className="uk-card uk-card-default uk-card-body uk-padding-small">
                    <h4 className="uk-card-title uk-margin-small">Image info</h4>
                    <div>Resolution: {imgElement.naturalWidth} × {imgElement.naturalHeight} px</div>
                   <div>File type: {lastFile?.type || "unknown"}</div>
                    <div>File size: {lastFile ? formatBytes(lastFile.size) : "unknown"}</div>
                    <div>DPI: {dpiInfo}</div>
                  </div>
                )}
              </div>
             </div>
           )}
         </>
       )}
     </div>
   );
 }
 
 // helpers: DPI parsers (PNG pHYs and minimal JPEG EXIF rational reader)
 function parsePNG_DPI(dv: DataView): string | null {
   // PNG signature check
   if (dv.byteLength < 24) return null;
   const sig = String.fromCharCode(...new Uint8Array(dv.buffer, 0, 8));
   if (sig !== "\x89PNG\r\n\x1a\n") return null;
   let offset = 8;
   while (offset + 8 < dv.byteLength) {
     const length = dv.getUint32(offset);
     const type = String.fromCharCode(
       dv.getUint8(offset + 4),
       dv.getUint8(offset + 5),
       dv.getUint8(offset + 6),
       dv.getUint8(offset + 7)
     );
     if (type === "pHYs" && length >= 9) {
       const pxPerUnitX = dv.getUint32(offset + 8);
       const pxPerUnitY = dv.getUint32(offset + 12);
       const unit = dv.getUint8(offset + 16); // 1 = meter, 0 = unknown
       if (unit === 1 && pxPerUnitX && pxPerUnitY) {
         const dpiX = Math.round(pxPerUnitX * 0.0254);
         const dpiY = Math.round(pxPerUnitY * 0.0254);
         return `${dpiX} × ${dpiY} DPI`;
       }
       return "unknown";
     }
     offset += 8 + length + 4; // len + type + data + crc
   }
   return null;
 }

 function parseJPEG_EXIF_DPI(dv: DataView): string | null {
   // look for APP1 0xFFE1 marker with "Exif" header
   let pos = 2; // skip SOI (0xFFD8)
   if (dv.getUint8(0) !== 0xFF || dv.getUint8(1) !== 0xD8) return null;
   while (pos + 4 < dv.byteLength) {
     if (dv.getUint8(pos) !== 0xFF) break;
     const marker = dv.getUint8(pos + 1);
     const len = dv.getUint16(pos + 2);
     if (marker === 0xE1) {
       // EXIF block
       const exifStart = pos + 4;
       const exifHeader = String.fromCharCode(
         dv.getUint8(exifStart),
         dv.getUint8(exifStart + 1),
         dv.getUint8(exifStart + 2),
         dv.getUint8(exifStart + 3),
         dv.getUint8(exifStart + 4),
         dv.getUint8(exifStart + 5)
       );
       if (exifHeader === "Exif\0\0") {
         try {
           const tiffOffset = exifStart + 6;
           const little = dv.getUint16(tiffOffset) === 0x4949;
           const getUint16 = (o: number) => little ? dv.getUint16(o, true) : dv.getUint16(o);
           const getUint32 = (o: number) => little ? dv.getUint32(o, true) : dv.getUint32(o);
           const ifd0Offset = tiffOffset + getUint32(tiffOffset + 4);
           const entries = getUint16(ifd0Offset);
           let xRes: number | null = null;
           let yRes: number | null = null;
           let resUnit = 2; // default inches
           for (let i = 0; i < entries; i++) {
             const entryOffset = ifd0Offset + 2 + i * 12;
             const tag = getUint16(entryOffset);
             const valueOffset = entryOffset + 8;
             if (tag === 0x011a || tag === 0x011b) {
               // rational stored as two uint32 at the pointed offset
               const valPtr = tiffOffset + getUint32(valueOffset);
               const num = getUint32(valPtr);
               const den = getUint32(valPtr + 4);
               const val = den ? num / den : null;
               if (tag === 0x011a) xRes = val;
               else yRes = val;
             }
             if (tag === 0x0128) {
               // resolution unit
               const v = getUint16(valueOffset);
               resUnit = v || resUnit;
             }
           }
           if (xRes && yRes) {
             // EXIF units: 2 = inches, 3 = centimeters
             if (resUnit === 3) { // per cm -> convert to DPI
               return `${Math.round(xRes * 2.54)} × ${Math.round(yRes * 2.54)} DPI`;
             }
             return `${Math.round(xRes)} × ${Math.round(yRes)} DPI`;
           }
         } catch (e) {
           return null;
         }
       }
     }
     pos += 2 + len;
   }
   return null;
 }

 function formatBytes(bytes: number) {
   if (!bytes) return "0 B";
   const units = ["B","KB","MB","GB"];
   let i = 0;
   let v = bytes;
   while (v >= 1024 && i < units.length-1) { v /= 1024; i++; }
   return `${v.toFixed(i ? 2 : 0)} ${units[i]}`;
 }
