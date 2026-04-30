import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { Column1 } from './columns/Column1';
import { Column2 } from './columns/Column2';
import { Column3 } from './columns/Column3';
import { Column4 } from './columns/Column4';

const formatErrorArg = (a: unknown): string => {
  if (a instanceof Error) return a.message;
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') {
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  return String(a);
};

export default function MainApp() {
  const errorBanner = useAppStore((s) => s.errorBanner);
  const dismissError = useAppStore((s) => s.dismissError);
  const noticeBanner = useAppStore((s) => s.noticeBanner);

  useEffect(() => {
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      originalError.apply(console, args as []);
      const message = args.map(formatErrorArg).join(' ').trim();
      if (message) useAppStore.getState().showError(message);
    };

    const onError = (e: ErrorEvent) => {
      useAppStore.getState().showError(e.message || 'Uncaught error');
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error ? e.reason.message : formatErrorArg(e.reason);
      useAppStore.getState().showError(`Unhandled promise rejection: ${reason}`);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      console.error = originalError;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return (
    <>
      <div className="fixed top-0 inset-x-0 z-50 flex flex-col">
        {errorBanner && (
          <div
            role="alert"
            className="bg-red-600 text-white px-4 py-2 shadow-lg flex items-center gap-3"
          >
            <span className="font-semibold shrink-0">Error:</span>
            <span className="flex-1 truncate text-sm">{errorBanner.message}</span>
            {errorBanner.count > 1 && (
              <span className="bg-red-800 rounded px-2 py-0.5 text-xs font-mono shrink-0">
                ×{errorBanner.count}
              </span>
            )}
            <button
              type="button"
              onClick={dismissError}
              aria-label="Dismiss error"
              className="text-white/90 hover:text-white text-2xl leading-none px-2 shrink-0"
            >
              ×
            </button>
          </div>
        )}
        {noticeBanner && (
          <div
            role="status"
            className="bg-orange-500 text-white px-4 py-2 shadow-lg flex items-center gap-3"
          >
            <span className="font-semibold shrink-0">Warning:</span>
            <span className="flex-1 truncate text-sm">{noticeBanner.message}</span>
          </div>
        )}
      </div>
      <div className="flex h-screen w-full gap-4 p-4 bg-slate-100 overflow-hidden">
        <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
          <Column1 />
        </div>
        <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
          <Column2 />
        </div>
        <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
          <Column3 />
        </div>
        <div className="flex-1 bg-white rounded-xl border p-4 overflow-y-auto shadow-sm">
          <Column4 />
        </div>
      </div>
    </>
  );
}
