import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const SCRIPTS_REPO = process.env.PYTHON_SCRIPTS_REPO || "/";
const INDEX_PATH = join(SCRIPTS_REPO, "scripts_index.json");

let _index: any[] | null = null;

interface ScriptEntry {
  name: string;
  category: string;
  path: string;
  description: string;
  size: number;
}

function getIndex(): ScriptEntry[] {
  if (_index) return _index;
  try {
    const raw = readFileSync(INDEX_PATH, "utf-8");
    _index = JSON.parse(raw);
    return _index!;
  } catch {
    return [];
  }
}

/**
 * GET /api/scripts
 * List all available scripts, optionally filtered by category and/or search query.
 * Query params: ?category=AUTOMATION&q=email&limit=100
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const q = searchParams.get("q")?.toLowerCase();
  const limit = parseInt(searchParams.get("limit") || "100");

  let scripts = getIndex();

  if (category) {
    scripts = scripts.filter((s) => s.category === category);
  }

  if (q) {
    scripts = scripts.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.path.toLowerCase().includes(q)
    );
  }

  const total = scripts.length;
  scripts = scripts.slice(0, limit);

  return NextResponse.json({
    total,
    returned: scripts.length,
    categories: [...new Set(getIndex().map((s) => s.category))].sort(),
    scripts,
  });
}