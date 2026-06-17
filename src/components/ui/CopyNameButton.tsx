import { useState, useRef, useEffect } from 'react';

// Strips a trailing image extension so the clipboard gets the bare standardized
// name (e.g. "aiimg_creativeonly_16705_11_nbp_2"), which is exactly what buyers
// paste into the Facebook Ad name field. Column4 names already come without an
// extension; Creative Edit names may carry one, so we normalize both here.
const stripExt = (name: string): string => name.replace(/\.(png|jpe?g|webp)$/i, '');

// Small "copy the creative's file name" button. Lives next to a generated image
// so the operator can grab the standardized name in one click. Stops click
// propagation so it can sit on top of a clickable thumbnail without opening it.
export const CopyNameButton = ({
  fileName,
  className = '',
}: {
  fileName: string;
  className?: string;
}) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const name = stripExt(fileName);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(name);
    } catch {
      // Fallback for non-secure contexts / older browsers without the async API.
      const ta = document.createElement('textarea');
      ta.value = name;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy image name: ${name}`}
      className={`inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium leading-none transition-colors ${
        copied
          ? 'border-green-400 bg-green-50 text-green-700'
          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
      } ${className}`}
    >
      {copied ? '✓ Copied' : '📋 Image name'}
    </button>
  );
};
