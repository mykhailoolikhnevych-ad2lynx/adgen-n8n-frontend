import React from 'react';
import { Column1 } from './columns/Column1';
import { Column2 } from './columns/Column2';
import { Column3 } from './columns/Column3'; // Создай по аналогии с Col2
import { Column4 } from './columns/Column4'; // Создай по аналогии с Col2

export default function MainApp() {
  return (
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
  );
}