import React, { useRef, useState, useEffect } from "react";
import { Stage, Layer, Image as KonvaImage, Transformer, Rect } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";

export default function ImageEditor() {
  const stageRef = useRef<any>(null);
  const imageNodeRef = useRef<any>(null);
  const rectRef = useRef<any>(null);
  const trRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAreaRef = useRef<HTMLDivElement | null>(null);
  const dragCounter = useRef(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [fileSrc, setFileSrc] = useState<string | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);

  // Add this ref at the top with your other refs
  const containerRef = useRef<HTMLDivElement>(null);

  const [selection, setSelection] = useState({ x: 50, y: 50, width: 300, height: 300, rotation: 0 });
  const [keepRatio, setKeepRatio] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Image transform state (pan + zoom)
  const [imageScale, setImageScale] = useState(1); // zoom multiplier relative to fit-to-stage width
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 }); // pan offset relative to centered position
  const [isPanning, setIsPanning] = useState(false);
  // Add this state for responsive dimensions (after your other useState declarations)
  const [stageDimensions, setStageDimensions] = useState({ width: 800, height: 600 });
  const panLast = useRef<{ x: number; y: number } | null>(null);

  const [aspect, setAspect] = useState<string>("1:1");
  useEffect(() => setIsClient(true), []);

  const stageWidth = stageDimensions.width;
  const stageHeight = stageDimensions.height;

  const aspectMap: Record<string, number> = {
    "1:1": 1 / 1,
    "1:2": 1 / 2,
    "2:3": 2 / 3,
    "3:4": 3 / 4,
    "4:5": 4 / 5,
    "16:9": 16 / 9,
    "3:2": 3 / 2,
    "4:3": 4 / 3
  };

  function handleFileObject(f: File) {
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new window.Image();
    img.src = url;
    img.onload = () => {
      setFileSrc(url);
      setImgElement(img);
      setImageScale(1);
      setImageOffset({ x: 0, y: 0 });
      const sw = Math.min(400, stageWidth - 40);
      const ar = aspectMap[aspect] ?? 1;
      setSelection({
        x: Math.round((stageWidth - sw) / 2),
        y: Math.round((stageHeight - Math.round(sw / ar)) / 2),
        width: sw,
        height: Math.round(sw / ar),
        rotation: 0
      });
    };
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFileObject(f);
  }

  // displayed image dimensions (fit-to-stage width base)
  const baseDisplayWidth = stageWidth;
  const displayedImageWidth = baseDisplayWidth * imageScale;
  const displayedImageHeight = imgElement ? (imgElement.naturalHeight * displayedImageWidth) / imgElement.naturalWidth : stageHeight;

  const baseX = (stageWidth - displayedImageWidth) / 2;
  const baseY = (stageHeight - displayedImageHeight) / 2;
  const imageX = baseX + imageOffset.x;
  const imageY = baseY + imageOffset.y;

  function clampOffset(off: { x: number; y: number }) {
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
  }

  function clampSelection(sel: typeof selection) {
    const s = { ...sel };
    if (s.x < 0) s.x = 0;
    if (s.y < 0) s.y = 0;
    if (s.x + s.width > stageWidth) s.x = stageWidth - s.width;
    if (s.y + s.height > stageHeight) s.y = stageHeight - s.height;
    return s;
  }

  useEffect(() => {
    if (trRef.current && rectRef.current) {
      trRef.current.nodes([rectRef.current]);
      trRef.current.getLayer() && trRef.current.getLayer().batchDraw();
    }
  }, [trRef.current, rectRef.current]);

  useEffect(() => {
    const node = rectRef.current;
    if (!node) return;
    node.x(selection.x);
    node.y(selection.y);
    node.width(selection.width);
    node.height(selection.height);
    node.rotation(selection.rotation || 0);
    node.getLayer() && node.getLayer().batchDraw();
  }, [selection]);

  // Add/replace updateDimensions useEffect to measure the stage wrapper (panelRef)
  useEffect(() => {
    const nodeGetter = () => panelRef.current ?? containerRef.current;
    let node = nodeGetter();
    if (!node) return;

    const measure = () => {
      node = nodeGetter();
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const width = Math.max(0, Math.round(rect.width));
      const height = Math.min(window.innerHeight - 300, 600);
      setStageDimensions((prev) => {
        if (prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    };

    // initial measure after paint
    const raf = requestAnimationFrame(measure);

    // React to element size changes (handles CSS/layout/initial paint timing)
    const ResizeObs = (window as any).ResizeObserver;
    let ro: any = null;
    if (ResizeObs) {
      ro = new ResizeObs(() => {
        // measure on the next frame to ensure layout settled
        requestAnimationFrame(measure);
      });
      ro.observe(node);
    } else {
      // fallback: listen to window resize and load
      window.addEventListener('resize', measure);
      window.addEventListener('load', measure);
    }

    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      else {
        window.removeEventListener('resize', measure);
        window.removeEventListener('load', measure);
      }
    };
  }, []);

  // Initialize UIkit upload (if UIkit present) to wire the drag-and-drop area
  useEffect(() => {
    const UIkit = (window as any).UIkit;
    const bar = document.getElementById('js-progressbar') as HTMLProgressElement | null;
    if (!UIkit) return;

    UIkit.upload('.js-upload', {
      url: '',
      multiple: false,
      beforeSend: function () { console.log('beforeSend', arguments); },
      beforeAll: function () { console.log('beforeAll', arguments); },
      load: function () { console.log('load', arguments); },
      error: function () { console.log('error', arguments); },
      complete: function () { console.log('complete', arguments); },
      loadStart: function (e: any) {
        console.log('loadStart', arguments);
        if (bar) { bar.removeAttribute('hidden'); bar.max = e.total; bar.value = e.loaded; }
      },
      progress: function (e: any) {
        console.log('progress', arguments);
        if (bar) { bar.max = e.total; bar.value = e.loaded; }
      },
      loadEnd: function (e: any) {
        console.log('loadEnd', arguments);
        if (bar) { bar.max = e.total; bar.value = e.loaded; }
      },
      completeAll: function () {
        console.log('completeAll', arguments);
        setTimeout(() => { if (bar) bar.setAttribute('hidden', 'hidden'); }, 1000);
        alert('Upload Completed');
      }
    });
  }, []);

  function onRectTransformEnd() {
    const node = rectRef.current;
    if (!node) return;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    // Reset scale to 1 and update width/height directly
    node.scaleX(1);
    node.scaleY(1);

    const newSel = {
      ...selection,
      x: Math.round(node.x()),
      y: Math.round(node.y()),
      width: Math.max(10, Math.round(node.width() * scaleX)),
      height: Math.max(10, Math.round(node.height() * scaleY)),
      rotation: node.rotation()
    };

    setSelection(clampSelection(newSel));
  }
  async function exportCropped() {
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

    ctx.drawImage(imgElement, sx, sy, sWidth, sHeight, 0, 0, exportCanvas.width, exportCanvas.height);

    // Convert canvas to blob
    exportCanvas.toBlob(async (blob) => {
      if (!blob) return;

      // Create FormData
      const formData = new FormData();
      formData.append('image', blob, 'crop.png');

      // Add metadata
      const metadata = {
        originalWidth: imgElement.naturalWidth,
        originalHeight: imgElement.naturalHeight,
        cropX: Math.round(sx),
        cropY: Math.round(sy),
        cropWidth: Math.round(sWidth),
        cropHeight: Math.round(sHeight)
      };
      formData.append('metadata', JSON.stringify(metadata));

      try {
        // Send to API
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });

        const result = await response.json();

        if (result.success) {
          alert(`Image uploaded successfully! ID: ${result.id}`);
          console.log('Upload result:', result);
        } else {
          alert(`Upload failed: ${result.error}`);
        }
      } catch (error) {
        console.error('Upload error:', error);
        alert('Upload failed. Check console for details.');
      }
    }, 'image/png');
  }


  function handleStageMouseDown(e: any) {
    const clickedOn = e.target;
    if (clickedOn === rectRef.current || (clickedOn.getParent && clickedOn.getParent() === rectRef.current)) return;
    setIsPanning(true);
    const pos = stageRef.current.getPointerPosition();
    panLast.current = pos;
  }
  function handleStageMouseMove() {
    if (!isPanning || !panLast.current) return;
    const pos = stageRef.current.getPointerPosition();
    const dx = pos.x - panLast.current.x;
    const dy = pos.y - panLast.current.y;
    panLast.current = pos;
    setImageOffset((prev) => clampOffset({ x: prev.x + dx, y: prev.y + dy }));
  }
  function handleStageMouseUp() {
    setIsPanning(false);
    panLast.current = null;
  }

  function handleWheel(e: any) {
    if (!imgElement) return;
    e.evt.preventDefault();
    const oldScale = imageScale;
    const pointer = stageRef.current.getPointerPosition();
    const mouseX = pointer.x;
    const mouseY = pointer.y;
    const scaleBy = 1.05;
    const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    const clamped = Math.max(0.2, Math.min(3, newScale));
    const imagePointBefore = { x: (mouseX - baseX - imageOffset.x) / oldScale, y: (mouseY - baseY - imageOffset.y) / oldScale };
    const newOffsetX = mouseX - baseX - imagePointBefore.x * clamped;
    const newOffsetY = mouseY - baseY - imagePointBefore.y * clamped;
    setImageScale(clamped);
    setImageOffset(clampOffset({ x: newOffsetX, y: newOffsetY }));
  }

  if (!isClient) {
    return (
      <div ref={containerRef} className="uk-container uk-padding">
        <div className="uk-grid uk-grid-small uk-flex-middle" style={{ marginBottom: 12 }}>
          <div className="uk-width-auto uk-margin">
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
          <div className="uk-width-auto uk-margin">
            <label className="uk-form-label" style={{ margin: 0 }}>
              <input className="uk-checkbox" type="checkbox" checked={keepRatio} readOnly />
              <span style={{ marginLeft: 8 }}>Keep aspect ratio</span>
            </label>
          </div>
          <div className="uk-width-auto uk-margin">
            <button className="uk-button uk-button-primary">Export Crop</button>
          </div>
        </div>
        <div className="uk-panel uk-overflow-auto" style={{ border: "1px solid #ccc", background: "#fff", minHeight: stageHeight }} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="uk-container uk-padding">
      <div className="uk-grid uk-grid-small uk-flex-middle uk-margin-bottom" style={{ marginBottom: 12 }}>
        <div className="uk-width-auto ">
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

        <div className="uk-width-auto uk-margin">
          <label className="uk-form-label" style={{ margin: 0 }}>
            <input className="uk-checkbox" type="checkbox" checked={keepRatio} onChange={() => setKeepRatio((v) => !v)} />
            <span style={{ marginLeft: 6 }}>Keep aspect ratio</span>
          </label> 
        </div>

        <div className="uk-width-auto uk-margin">
          <label className="uk-form-label" style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
            <span style={{ marginRight: 6 }}>Aspect:</span>
            <select className="uk-select uk-form-width-small" value={aspect} onChange={(e) => {
              const next = e.target.value;
              setAspect(next);

              // Always update the selection box to match the new aspect ratio
              const ar = aspectMap[next] ?? 1;
              const centerX = selection.x + selection.width / 2;
              const centerY = selection.y + selection.height / 2;

              // Keep the width, recalculate height based on new aspect ratio
              let newW = selection.width;
              let newH = Math.round(newW / ar);

              // If new height is too tall for stage, scale down
              if (newH > stageHeight) {
                newH = stageHeight - 40;
                newW = Math.round(newH * ar);
              }

              // If new width is too wide for stage, scale down
              if (newW > stageWidth) {
                newW = stageWidth - 40;
                newH = Math.round(newW / ar);
              }

              // Recenter the selection box
              const nx = Math.max(0, Math.min(stageWidth - newW, Math.round(centerX - newW / 2)));
              const ny = Math.max(0, Math.min(stageHeight - newH, Math.round(centerY - newH / 2)));

              setSelection({ ...selection, x: nx, y: ny, width: newW, height: newH });
            }}>

              <option>1:1</option>
              <option>1:2</option>
              <option>2:3</option>
              <option>3:4</option>
              <option>4:5</option>
              <option>16:9</option>
              <option>3:2</option>
              <option>4:3</option>
            </select>
          </label>
        </div>

        <div className="uk-width-expand@s uk-width-1-3@m">
          <label className="uk-form-label" style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
            <span>Zoom:</span>
            <input className="uk-range" type="range" min={0.2} max={3} step={0.01} value={imageScale} onChange={(e) => {
              const v = Number(e.target.value);
              const center = { x: stageWidth / 2, y: stageHeight / 2 };
              const oldScale = imageScale;
              const imagePointBefore = { x: (center.x - baseX - imageOffset.x) / oldScale, y: (center.y - baseY - imageOffset.y) / oldScale };
              setImageScale(v);
              setImageOffset(() => clampOffset({ x: center.x - baseX - imagePointBefore.x * v, y: center.y - baseY - imagePointBefore.y * v }));
            }} style={{ width: 160 }} />
            <input className="uk-input uk-form-width-small" type="number" step="0.01" value={imageScale} onChange={(e) => {
              let v = Number(e.target.value);
              if (isNaN(v)) v = 1;
              v = Math.max(0.2, Math.min(3, v));
              const center = { x: stageWidth / 2, y: stageHeight / 2 };
              const oldScale = imageScale;
              const imagePointBefore = { x: (center.x - baseX - imageOffset.x) / oldScale, y: (center.y - baseY - imageOffset.y) / oldScale };
              setImageScale(v);
              setImageOffset(() => clampOffset({ x: center.x - baseX - imagePointBefore.x * v, y: center.y - baseY - imagePointBefore.y * v }));
            }} style={{ width: 64 }} />
          </label>
        </div>

        <div className="uk-width-auto uk-margin">
          <button className="uk-button" onClick={() => {
            setImageScale(1);
            setImageOffset({ x: 0, y: 0 });
            const sw = Math.min(400, stageWidth - 40);
            const ar = aspectMap[aspect] ?? 1;
            setSelection({
              x: Math.round((stageWidth - sw) / 2),
              y: Math.round((stageHeight - Math.round(sw / ar)) / 2),
              width: sw,
              height: Math.round(sw / ar),
              rotation: 0
            });
          }}>Reset</button>
        </div>

        <div className="uk-width-auto uk-margin">
          <button className="uk-button uk-button-primary" onClick={exportCropped}>Export Crop</button>
        </div>

      <div className="uk-width-expand">
       <div className="uk-text-muted" style={{ marginLeft: 12 }}>Tip: drag background to pan, wheel to zoom (or use controls)</div>
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
             <span uk-icon="icon: cloud-upload"></span>
             <span className="uk-text-middle" style={{ marginLeft: 8 }}>Attach binaries by dropping them here </span>
             
           </div>
           <progress id="js-progressbar" className="uk-progress" value={0} max={100} hidden></progress>
         </div>        
       </div>
      </div>

      <div ref={panelRef} className="uk-panel uk-overflow-auto uk-margin-auto" style={{ width: "100%", maxWidth: 820 }}>
        <Stage
          pixelRatio={1}               // set 1 to keep canvas.width == css width
          width={stageWidth}
          height={stageHeight}
          ref={stageRef}
          style={{ border: "1px solid #ccc", background: "#fff", cursor: isPanning ? "grabbing" : "grab", display: "block", margin: "0 auto" }}
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
              stroke="rgba(0,150,255,0.9)"
              strokeWidth={2}
              dash={[6, 4]}
              draggable
              onDragEnd={(e: KonvaEventObject<DragEvent>) => {
                const newSel = { ...selection, x: e.target.x(), y: e.target.y() };
                setSelection(clampSelection(newSel));
              }}
              onTransformEnd={onRectTransformEnd}
            />

            <Transformer
              ref={trRef}
              keepRatio={keepRatio}
              enabledAnchors={
                keepRatio
                  ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                  : ["top-left", "top-center", "top-right", "middle-right", "bottom-right", "bottom-center", "bottom-left", "middle-left"]
              }
              boundBoxFunc={(oldBox, newBox) => {
                // Prevent the selection from being resized too small
                if (Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10) {
                  return oldBox;
                }

                // Enforce aspect ratio during resize when keepRatio is on
                if (keepRatio) {
                  const ar = aspectMap[aspect] ?? 1;

                  // Determine which dimension changed more
                  const widthChange = Math.abs(newBox.width - oldBox.width);
                  const heightChange = Math.abs(newBox.height - oldBox.height);

                  if (widthChange > heightChange) {
                    // Width changed, adjust height
                    const newHeight = Math.abs(newBox.width) / ar;
                    return {
                      ...newBox,
                      height: newBox.height < 0 ? -newHeight : newHeight
                    };
                  } else {
                    // Height changed, adjust width
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
      </div>
    </div>
  );
}
