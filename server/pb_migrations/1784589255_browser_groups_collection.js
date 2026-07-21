/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    name: "browser_groups",
    type: "base",
    fields: [
      {
        name: "groups",
        type: "json",
        maxSize: 20000,
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
    deleteRule: "@request.auth.id != ''",
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("browser_groups");
  return app.delete(collection);
});
