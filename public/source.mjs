// Where contracts come from: the server's API when there is one, the snapshots baked at build time otherwise.
// Every page reads through this, so they all see the same data.

export async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });   // always revalidate: a new deploy shows at once, an unchanged one costs a 304
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${path}`);
  return body;
}

const SOURCES = {
  server: {
    contracts: () => getJSON('api/contracts'),
    societies: () => getJSON('api/societies'),
    snapshot: id => getJSON(`api/contracts/${encodeURIComponent(id)}/snapshot`),
    demesnes: () => getJSON('api/demesnes'),
  },
  static: {
    contracts: () => getJSON('data/contracts.json'),
    societies: () => getJSON('data/societies.json'),
    snapshot: id => getJSON(`data/snapshots/${encodeURIComponent(id)}.json`),
    demesnes: () => getJSON('data/demesnes.json'),
  },
};

// A 404 from api/config is an answer, not an error: there is no server, so read the baked files.
export const findSource = () => getJSON('api/config').then(() => SOURCES.server, () => SOURCES.static);
