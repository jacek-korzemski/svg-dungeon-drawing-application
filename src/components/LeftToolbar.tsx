import React, { useState } from 'react';
import {
  BrickWall,
  Brush,
  DoorOpen,
  Eraser,
  Footprints,
  Hand,
  Hexagon,
  LayoutGrid,
  MousePointer2,
  Package,
  Paintbrush,
  Route,
  Spline,
  Square,
  Type,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { EraserShape, LayerEnvironment, ToolType } from '../types/dungeon';

interface LeftToolbarProps {
  activeTool: ToolType;
  environment: LayerEnvironment;
  eraserShape: EraserShape;
  onSelectTool: (tool: ToolType) => void;
  onChangeEraserShape: (shape: EraserShape) => void;
}

interface ToolDef {
  id: ToolType;
  shortcut: string;
  icon: React.FC<{ className?: string }>;
  group: 'select' | 'carve' | 'arch' | 'detail';
}

const TOOLS: ToolDef[] = [
  { id: 'select', shortcut: 'V', icon: MousePointer2, group: 'select' },
  { id: 'pan', shortcut: 'H', icon: Hand, group: 'select' },
  { id: 'room', shortcut: 'R', icon: Square, group: 'carve' },
  { id: 'corridor', shortcut: 'C', icon: Route, group: 'carve' },
  { id: 'cave', shortcut: 'B', icon: Paintbrush, group: 'carve' },
  { id: 'polygon', shortcut: 'G', icon: Hexagon, group: 'carve' },
  { id: 'district', shortcut: 'K', icon: LayoutGrid, group: 'carve' },
  { id: 'eraser', shortcut: 'E', icon: Eraser, group: 'carve' },
  { id: 'wall', shortcut: 'W', icon: BrickWall, group: 'arch' },
  { id: 'door', shortcut: 'D', icon: DoorOpen, group: 'arch' },
  { id: 'stairs', shortcut: 'S', icon: Footprints, group: 'arch' },
  { id: 'texture', shortcut: 'M', icon: Brush, group: 'detail' },
  { id: 'prop', shortcut: 'P', icon: Package, group: 'detail' },
  { id: 'label', shortcut: 'T', icon: Type, group: 'detail' },
];

const ERASER_SHAPES: { id: EraserShape; icon: React.FC<{ className?: string }> }[] = [
  { id: 'rect', icon: Square },
  { id: 'polygon', icon: Hexagon },
  { id: 'stroke', icon: Spline },
];

export const LeftToolbar: React.FC<LeftToolbarProps> = ({
  activeTool,
  environment,
  eraserShape,
  onSelectTool,
  onChangeEraserShape,
}) => {
  const { messages } = useI18n();
  const [eraserOpen, setEraserOpen] = useState(false);
  const tools = TOOLS.filter((tool) => environment === 'exterior' || tool.id !== 'district').map((tool) => {
    const exteriorCopy =
      environment === 'exterior' && tool.id in messages.tools.exterior
        ? messages.tools.exterior[tool.id as keyof typeof messages.tools.exterior]
        : null;
    return { ...tool, ...(exteriorCopy ?? messages.tools[tool.id]) };
  });

  return (
    <aside className="w-13 bg-[#141619] border-r border-[#2D333D] flex flex-col items-center py-2.5 gap-1 z-20 shrink-0 select-none overflow-visible">
      {tools.map((tool, idx) => {
        const Icon = tool.icon;
        const isActive = activeTool === tool.id;
        const prevGroup = idx > 0 ? tools[idx - 1].group : tool.group;
        const showDivider = idx > 0 && prevGroup !== tool.group;
        const eraserMenu = tool.id === 'eraser';

        return (
          <React.Fragment key={tool.id}>
            {showDivider && <div className="w-7 h-px bg-[#2D333D] my-1" />}
            <div
              className="relative"
              onMouseEnter={() => eraserMenu && setEraserOpen(true)}
              onMouseLeave={() => eraserMenu && setEraserOpen(false)}
            >
              <button
                onClick={() => {
                  onSelectTool(tool.id);
                  if (eraserMenu) setEraserOpen(true);
                }}
                title={`${tool.label} (${tool.shortcut}) — ${tool.description}`}
                className={`group relative w-9.5 h-9.5 rounded-lg flex items-center justify-center transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950/60'
                    : 'text-[#9CA3AF] hover:text-[#F1F3F5] hover:bg-[#1C1F24]'
                }`}
              >
                <Icon className="w-4.5 h-4.5" />
                <span
                  className={`absolute bottom-0.5 right-1 text-[8px] font-mono-tech leading-none ${
                    isActive ? 'text-indigo-200' : 'text-[#6B7280] group-hover:text-[#9CA3AF]'
                  }`}
                >
                  {tool.shortcut}
                </span>
              </button>
              {eraserMenu && (eraserOpen || isActive) && (
                <div className="absolute left-full top-0 ml-2 z-40 flex flex-col gap-1 rounded-lg border border-[#2D333D] bg-[#1C1F24] p-1 shadow-xl">
                  {ERASER_SHAPES.map((shape) => {
                    const ShapeIcon = shape.icon;
                    const selected = eraserShape === shape.id;
                    const shapeLabel = messages.eraserShapes[shape.id];
                    return (
                      <button
                        key={shape.id}
                        type="button"
                        title={shapeLabel}
                        onClick={() => {
                          onChangeEraserShape(shape.id);
                          onSelectTool('eraser');
                        }}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] whitespace-nowrap ${
                          selected
                            ? 'bg-indigo-600 text-white'
                            : 'text-[#D1D5DB] hover:bg-[#252A32]'
                        }`}
                      >
                        <ShapeIcon className="w-3.5 h-3.5" />
                        {shapeLabel}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </aside>
  );
};
