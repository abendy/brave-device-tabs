/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    name: "shared_links",
    type: "base",
    fields: [
      {
        name: "url",
        type: "url",
        required: true,
      },
      {
        name: "title",
        type: "text",
        max: 500,
      },
      {
        name: "source",
        type: "text",
        max: 200,
      },
      {
        name: "opened",
        type: "bool",
      },
      {
        name: "created",
        type: "autodate",
        onCreate: true,
        onUpdate: false,
      },
      {
        name: "updated",
        type: "autodate",
        onCreate: true,
        onUpdate: true,
      },
    ],
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    deleteRule: null,
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("shared_links");
  return app.delete(collection);
});
