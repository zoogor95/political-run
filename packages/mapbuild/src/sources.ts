/** Public boundary files the boards are built from. Each is pinned to a release and checked by hash, so builds repeat exactly. */

export interface Source {
  id: string;
  file: string;
  url: string;
  sha256: string;
  licence: string;
  credit: string;
}

export const SOURCES: Source[] = [
  {
    id: "natural-earth-admin1",
    file: "ne_10m_admin_1_states_provinces.geojson",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson",
    sha256: "22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5",
    licence: "Public domain",
    credit: "Made with Natural Earth. Free vector and raster map data at naturalearthdata.com.",
  },
  {
    id: "geoboundaries-pak-adm2",
    file: "geoBoundaries-PAK-ADM2_simplified.geojson",
    url: "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/8ce2700661a28ee944350e2b329bbabb58d2ff83/releaseData/gbOpen/PAK/ADM2/geoBoundaries-PAK-ADM2_simplified.geojson",
    sha256: "f274cfc377b3b570b6fd620c2911b5e4acd14460f9cb48551747f1d698566f2e",
    licence: "Public domain",
    credit: "Pakistan districts from geoBoundaries (Runfola et al., 2020, geoboundaries.org), sourced from Wikimedia Commons.",
  },
];

/** us-atlas is an npm dependency, so it needs no download. */
export const US_ATLAS_CREDIT = "US states from us-atlas, derived from US Census Bureau cartographic boundary files (public domain).";

export function source(id: string): Source {
  const s = SOURCES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown source "${id}"`);
  return s;
}
