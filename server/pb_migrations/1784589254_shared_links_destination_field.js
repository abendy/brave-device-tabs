/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("shared_links");
  collection.fields.add(new Field({
    name: "destination",
    type: "text",
    max: 200,
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("shared_links");
  collection.fields.removeByName("destination");
  return app.save(collection);
});
