/// <reference path="../pb_data/types.d.ts" />
// A pinned group is a standing save destination: it stays offered on the
// share sheet and Links screen even when the browser tab group is closed
// and no unopened links point at it. windowId 0 means "no window
// preference"; a stale window id degrades to title-only routing on open.
migrate((app) => {
  const collection = new Collection({
    name: "pinned_groups",
    type: "base",
    fields: [
      {
        name: "title",
        type: "text",
        required: true,
        max: 200,
      },
      {
        name: "windowId",
        type: "number",
        onlyInt: true,
      },
      {
        name: "created",
        type: "autodate",
        onCreate: true,
        onUpdate: false,
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
  const collection = app.findCollectionByNameOrId("pinned_groups");
  return app.delete(collection);
});
