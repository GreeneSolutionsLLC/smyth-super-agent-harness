"use client";

import { useState, useEffect, useCallback } from "react";

interface ScriptEntry {
  name: string;
  category: string;
  path: string;
  description: string;
  size: number;
}

interface ScriptsResponse {
  total: number;
  returned: number;
  categories: string[];
  scripts: ScriptEntry[];
}

interface RunResult {
  script: string;
  exitCode: number | null;
  duration: number;
  stdout: string;
  stderr: string | null;
  error?: string;
}

export default function ScriptsPanel() {
  const [scripts, setScripts] = useState<ScriptEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedScript, setSelectedScript] = useState<ScriptEntry | null>(null);
  const [runArgs, setRunArgs] = useState("");
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchScripts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedCategory) params.set("category", selectedCategory);
    if (searchQuery) params.set("q", searchQuery);
    params.set("limit", "200");

    try {
      const res = await fetch(`/api/scripts?${params}`);
      const data: ScriptsResponse = await res.json();
      setScripts(data.scripts);
      setCategories(data.categories);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, searchQuery]);

  useEffect(() => {
    fetchScripts();
  }, [fetchScripts]);

  const runScript = async () => {
    if (!selectedScript) return;
    setRunning(true);
    setRunResult(null);

    try {
      const args = runArgs
        .split(/\s+/)
        .filter(Boolean);

      const res = await fetch("/api/scripts/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: selectedScript.path,
          args,
          timeout: 30,
        }),
      });

      const data: RunResult = await res.json();
      setRunResult(data);
    } catch (err: any) {
      setRunResult({
        script: selectedScript.path,
        exitCode: -1,
        duration: 0,
        stdout: "",
        stderr: err.message,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🐍</span>
          <h2 className="text-sm font-semibold">Script Registry</h2>
          <span className="text-xs text-zinc-500">{scripts.length} scripts</span>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="px-4 py-2 border-b border-zinc-800 flex gap-2">
        <input
          type="text"
          placeholder="Search scripts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-zinc-900 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none"
        />
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="bg-zinc-900 text-sm px-2 py-1.5 rounded border border-zinc-700 focus:outline-none"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Script List */}
        <div className="w-1/2 overflow-y-auto border-r border-zinc-800">
          {loading ? (
            <div className="p-4 text-center text-zinc-500 text-sm">Loading...</div>
          ) : scripts.length === 0 ? (
            <div className="p-4 text-center text-zinc-500 text-sm">No scripts found</div>
          ) : (
            scripts.map((s) => (
              <button
                key={s.path}
                onClick={() => {
                  setSelectedScript(s);
                  setRunResult(null);
                  setRunArgs("");
                }}
                className={`w-full text-left px-4 py-2 border-b border-zinc-900 hover:bg-zinc-900 transition-colors ${
                  selectedScript?.path === s.path ? "bg-zinc-900" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{s.name}</span>
                  <span className="text-xs text-zinc-600 ml-2 shrink-0">
                    {(s.size / 1024).toFixed(1)}KB
                  </span>
                </div>
                {s.description && (
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">{s.description}</p>
                )}
                <p className="text-xs text-zinc-700 mt-0.5">{s.category}</p>
              </button>
            ))
          )}
        </div>

        {/* Detail + Run */}
        <div className="w-1/2 overflow-y-auto flex flex-col">
          {selectedScript ? (
            <>
              <div className="px-4 py-3 border-b border-zinc-800">
                <h3 className="text-sm font-semibold mb-1">{selectedScript.name}</h3>
                <p className="text-xs text-zinc-500 mb-2">{selectedScript.path}</p>
                {selectedScript.description && (
                  <p className="text-xs text-zinc-400 mb-2">
                    {selectedScript.description}
                  </p>
                )}
                <div className="flex gap-3 text-xs text-zinc-600">
                  <span>{(selectedScript.size / 1024).toFixed(1)} KB</span>
                  <span>{selectedScript.category}</span>
                </div>
              </div>

              <div className="px-4 py-3 border-b border-zinc-800">
                <label className="text-xs text-zinc-500 block mb-1">
                  Arguments (space-separated)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="--arg value"
                    value={runArgs}
                    onChange={(e) => setRunArgs(e.target.value)}
                    className="flex-1 bg-zinc-900 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none font-mono"
                  />
                  <button
                    onClick={runScript}
                    disabled={running}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 text-sm rounded font-medium transition-colors"
                  >
                    {running ? "Running..." : "Run"}
                  </button>
                </div>
              </div>

              {runResult && (
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        runResult.exitCode === 0
                          ? "bg-green-900 text-green-300"
                          : "bg-red-900 text-red-300"
                      }`}
                    >
                      Exit: {runResult.exitCode ?? "error"}
                    </span>
                    <span className="text-xs text-zinc-600">
                      {(runResult.duration / 1000).toFixed(2)}s
                    </span>
                  </div>

                  {runResult.stdout && (
                    <div className="mb-3">
                      <p className="text-xs text-zinc-500 mb-1">stdout</p>
                      <pre className="bg-zinc-900 text-green-400 text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-64">
                        {runResult.stdout}
                      </pre>
                    </div>
                  )}

                  {runResult.stderr && (
                    <div className="mb-3">
                      <p className="text-xs text-zinc-500 mb-1">stderr</p>
                      <pre className="bg-zinc-900 text-red-400 text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-64">
                        {runResult.stderr}
                      </pre>
                    </div>
                  )}

                  {runResult.error && (
                    <div className="mb-3">
                      <p className="text-xs text-zinc-500 mb-1">error</p>
                      <pre className="bg-zinc-900 text-red-400 text-xs p-3 rounded">
                        {runResult.error}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
              Select a script to view details and run
            </div>
          )}
        </div>
      </div>
    </div>
  );
}