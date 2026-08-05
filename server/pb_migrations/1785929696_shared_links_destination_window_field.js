/// <reference path="../pb_data/types.d.ts" />
// Destination titles alone cannot distinguish same-named tab groups in two
// browser windows, nor aim a new group at a window; 0 means "no preference".
migrate((app) => {
  const collection = app.findCollectionByNameOrId("shared_links");
  collection.fields.add(new Field({
    name: "destinationWindowId",
    type: "number",
    onlyInt: true,
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("shared_links");
  collection.fields.removeByName("destinationWindowId");
  return app.save(collection);
});
