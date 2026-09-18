// Where contracts come from: the server's API when there is one, the snapshots baked at build time otherwise.
// Every page reads through this, so they all see the same data. Three stores share one structure: the catalogue of
// social contracts, the bodies of knowledge a contract refers to, and the platform's own (its vocabulary and its
// services). The first two are one space to compose in; the platform's is read on its own.

export async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });   // always revalidate: a new deploy shows at once, an unchanged one costs a 304
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${path}`);
  return body;
}

export const STORES = { catalogue: 'Contracts', knowledge: 'Knowledge', system: 'Platform' };
export const storeOf = search => {
  const asked = new URLSearchParams(search).get('store');
  return asked && Object.hasOwn(STORES, asked) ? asked : 'catalogue';
};

const server = store => {
  const q = store === 'catalogue' ? '' : `?store=${store}`;
  return {
    contracts: () => getJSON(`api/contracts${q}`),
    societies: () => getJSON(`api/societies${q}`),
    snapshot: id => getJSON(`api/contracts/${encodeURIComponent(id)}/snapshot${q}`),
    demesnes: () => getJSON(`api/demesnes${q}`),
    catalogue: () => getJSON(`api/catalogue${q}`),
  };
};

const baked = store => {
  const dir = store === 'catalogue' ? 'data/' : `data/${store}/`;
  return {
    contracts: () => getJSON(`${dir}contracts.json`),
    societies: () => getJSON(`${dir}societies.json`),
    snapshot: id => getJSON(`${dir}snapshots/${encodeURIComponent(id)}.json`),
    demesnes: () => getJSON(`${dir}demesnes.json`),
    catalogue: () => getJSON(`${dir}catalogue.json`),
  };
};

// A 404 from api/config is an answer, not an error: there is no server, so read the baked files.
export const findSource = (store = 'catalogue') => getJSON('api/config').then(() => server(store), () => baked(store));
