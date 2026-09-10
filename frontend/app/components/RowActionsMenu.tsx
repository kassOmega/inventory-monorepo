"use client";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ActionItem {
  label: string;
  onClick: () => void;
  color?: string;
  disabled?: boolean;
}

// Renders in a portal on document.body so it is never clipped by
// table overflow, and flips up/left near the viewport edge.
export default function RowActionsMenu({ items }: { items: ActionItem[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = triggerRef.current!.getBoundingClientRect();
    const menuWidth = 170;
    const menuHeight = Math.min(items.length * 40 + 8, 320);
    let left = rect.right - menuWidth;
    if (left < 8) left = 8;
    let top = rect.bottom + 4;
    if (top + menuHeight > window.innerHeight - 8) {
      top = rect.top - menuHeight - 4;
      if (top < 8) top = 8;
    }
    setPos({ top, left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openMenu}
        className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        title={t("common.actions")}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[100] bg-white rounded shadow border py-1 min-w-[170px] overflow-y-auto"
            style={{ top: pos.top, left: pos.left, maxHeight: 320 }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  item.onClick();
                }}
                className={
                  "w-full text-left px-4 py-2 text-sm " +
                  (item.disabled
                    ? "text-gray-300 cursor-not-allowed"
                    : (item.color ?? "text-gray-700") + " hover:bg-gray-100")
                }
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
