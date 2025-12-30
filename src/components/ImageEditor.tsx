import React, { useRef, useState, useEffect } from "react";
import { Stage, Layer, Image as KonvaImage, Transformer, Rect } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";

export default function ImageEditor() {
  const stageRef = useRef<any>(null);
  const imageNodeRef = useRef<any>(null);
  const rectRef = useRef<any>(null);
  const trRef = useRef<any>(null);

  const [fileSrc, setFileSrc] = useState<string | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);

  const [selection, setSelection] = useState({ x: 50, y: 50, width: 300, height: 300, rotation: 0 });
  const [keepRatio, setKeepRatio] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Image transform state (pan + zoom)
  const [imageScale, setImageScale] = useState(1); // zoom multiplier relative to fit-to-stage width
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 }); // pan offset relative to centered position
  const [isPanning, setIsPanning] = useState(false);
  const panLast = useRef<{ x: number; y: number } | null>(null);

  const [aspect, setAspect] = useState<string>("1:1");
  useEffect(() => setIsClient(true), []);

  const stageWidth = 800;
  const stageHeight = 600;

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

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
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
      <div>
        <div style={{ marginBottom: 12 }}>
          <input type="file" accept="image/*" />
          <label style={{ marginLeft: 12 }}>
            <input type="checkbox" checked={keepRatio} readOnly />
            Keep aspect ratio
          </label>
          <button style={{ marginLeft: 12 }}>Export Crop</button>
        </div>
        <div style={{ border: "1px solid #ccc", background: "#fff", minHeight: stageHeight }} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "center" }}>
        <input type="file" accept="image/*" onChange={handleFile} />
        <label>
          <input type="checkbox" checked={keepRatio} onChange={() => setKeepRatio((v) => !v)} />
          Keep aspect ratio
        </label>

        <label>
          Aspect:
          <select value={aspect} onChange={(e) => {
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

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Zoom:
          <input
            type="range"
            min={0.2}
            max={3}
            step={0.01}
            value={imageScale}
            onChange={(e) => {
              const v = Number(e.target.value);
              const center = { x: stageWidth / 2, y: stageHeight / 2 };
              const oldScale = imageScale;
              const imagePointBefore = { x: (center.x - baseX - imageOffset.x) / oldScale, y: (center.y - baseY - imageOffset.y) / oldScale };
              setImageScale(v);
              setImageOffset(() => clampOffset({ x: center.x - baseX - imagePointBefore.x * v, y: center.y - baseY - imagePointBefore.y * v }));
            }}
            style={{ width: 160 }}
          />
          <input
            type="number"
            step="0.01"
            value={imageScale}
            onChange={(e) => {
              let v = Number(e.target.value);
              if (isNaN(v)) v = 1;
              v = Math.max(0.2, Math.min(3, v));
              const center = { x: stageWidth / 2, y: stageHeight / 2 };
              const oldScale = imageScale;
              const imagePointBefore = { x: (center.x - baseX - imageOffset.x) / oldScale, y: (center.y - baseY - imageOffset.y) / oldScale };
              setImageScale(v);
              setImageOffset(() => clampOffset({ x: center.x - baseX - imagePointBefore.x * v, y: center.y - baseY - imagePointBefore.y * v }));
            }}
            style={{ width: 64 }}
          />
        </label>

        <button onClick={() => {
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

        <button onClick={exportCropped}>Export Crop</button>
        <div style={{ marginLeft: 12, color: "#666" }}>Tip: drag background to pan, wheel to zoom (or use controls)</div>
      </div>

      <Stage
        width={stageWidth}
        height={stageHeight}
        ref={stageRef}
        style={{ border: "1px solid #ccc", background: "#fff", cursor: isPanning ? "grabbing" : "grab" }}
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
  );
}
