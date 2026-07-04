/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Download, Upload, HardDrive, List, FileBox } from 'lucide-react';
import AddTorrent from './components/AddTorrent';
import TorrentList from './components/TorrentList';
import StatsBar from './components/StatsBar';

export default function App() {
  const [activeTab, setActiveTab] = useState<'torrents' | 'add'>('add');

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-neutral-900 border-r border-neutral-800 flex flex-col hidden md:flex">
        <div className="p-6 border-b border-neutral-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
            <Download size={20} className="transform -rotate-90" />
          </div>
          <div>
            <h1 className="font-bold tracking-tight text-white">StreamTor</h1>
            <p className="text-[10px] text-cyan-400 uppercase tracking-widest font-mono">Browser Node</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab('add')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors ${activeTab === 'add' ? 'bg-cyan-500/10 text-cyan-400' : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'}`}
          >
            <Upload size={18} />
            <span>Add Torrent</span>
          </button>
          
          <button
            onClick={() => setActiveTab('torrents')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors ${activeTab === 'torrents' ? 'bg-cyan-500/10 text-cyan-400' : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'}`}
          >
            <List size={18} />
            <span>Active Downloads</span>
          </button>
          
          <div className="pt-4 mt-4 border-t border-neutral-800 px-4">
            <p className="text-xs font-mono text-neutral-500 uppercase tracking-widest mb-2">Network</p>
            <div className="flex items-center gap-3 py-2 text-sm text-neutral-400">
              <HardDrive size={18} />
              <span>Node.js Bridge</span>
            </div>
            <div className="flex items-center gap-3 py-2 text-sm text-neutral-400">
              <FileBox size={18} />
              <span>Native Downloads</span>
            </div>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 bg-neutral-950">
        <header className="h-16 border-b border-neutral-800 flex items-center px-6 md:hidden">
            <h1 className="font-bold tracking-tight text-white flex items-center gap-2">
              <Download size={18} className="text-cyan-400 transform -rotate-90" /> 
              StreamTor
            </h1>
        </header>

        <StatsBar />

        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-5xl mx-auto">
            {activeTab === 'add' ? (
              <AddTorrent onAdded={() => setActiveTab('torrents')} />
            ) : (
              <TorrentList />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
