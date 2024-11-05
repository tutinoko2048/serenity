import {
  Serenity,
  LevelDBProvider,
  WorldEvent,
  Player
} from "@serenityjs/core";
import { Pipeline } from "@serenityjs/plugins";

// Create a new Serenity instance
const serenity = new Serenity({
  port: 19142,
  permissions: "./permissions.json",
  debugLogging: true
});

// Create a new plugin pipeline
const pipeline = new Pipeline(serenity, { path: "./plugins" });

// Initialize the pipeline
void pipeline.initialize(() => {
  // Register the LevelDBProvider
  serenity.registerProvider(LevelDBProvider, { path: "./worlds" });

  // Start the server
  serenity.start();
});

serenity.on(WorldEvent.WorldInitialize, ({ world }) => {
  world.commands.register("test", "", (context) => {
    if (!(context.origin instanceof Player)) return;

    // context.origin.metadata.update();
    // context.origin.abilities.update();
    // context.origin.attributes.update();

    context.origin.spawn();
  });
});
