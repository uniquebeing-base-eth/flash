import { type ReactNode, useEffect } from "react";
import { X } from "lucide-react";

export function Drawer({ open, onClose, title, icon, children }: { open: boolean; onClose: () => void; title: string; icon?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      <div className="max-w-md mx-auto px-4 pt-6 pb-12">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            {icon}
            <h1 className="font-display text-3xl italic">{title}</h1>
          </div>
          <button onClick={onClose} className="box-sm w-11 h-11 grid place-items-center bg-foreground text-background">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}