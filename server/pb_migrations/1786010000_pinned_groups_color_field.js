/// <reference path="../pb_data/types.d.ts" />
// Pins remember their group's Chrome color so a pinned destination keeps
// its dot after the live group closes. The extension backfills this from
// the live group on every snapshot sync; empty means "no color known".
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pinned_groups");
  collection.fields.add(new Field({
    name: "color",
    type: "text",
    max: 40,
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pinned_groups");
  collection.fields.removeByName("color");
  return app.save(collection);
});
