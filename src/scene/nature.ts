
// Temporary stub: the nature-kit loader was lost in a half-undone edit.
// Returning null makes world.ts use its procedural forest.
export type NatureProgress = (loaded: number, total: number) => void;

export interface NatureAsset {
  role: string;
  [key: string]: any;
}

export interface NatureKit {
  [key: string]: any;
}

export async function loadNatureKit(_onProgress?: NatureProgress): Promise<NatureKit | null> {
  console.info('[nature] stub loader: using procedural forest');
  return null;
}