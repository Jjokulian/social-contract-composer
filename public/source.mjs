// Where contracts come from: the server's API when there is one, the snapshots baked at build time otherwise.
// Every page reads through this, so they all see the same data. There are two stores in the same structure: the
// catalogue of social contracts, and the platform's own (its vocabulary and, in time, its services and deployments).

export async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });   // always revalidate: a new deploy shows at once, an unchanged one costs a 304
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${path}`);
  return body;
}

export const STORES = { catalogue: 'Catalogue', system: 'Platform' };
export const storeOf = search => (new URLSearchParams(search).get('store') === 'system' ? 'system' : 'catalogue');

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
