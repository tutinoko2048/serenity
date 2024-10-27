import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";

import { BinaryStream, Endianness } from "@serenityjs/binarystream";
import { Leveldb } from "@serenityjs/leveldb";
import { ChunkCoords } from "@serenityjs/protocol";

import { Chunk, SubChunk } from "../chunk";
import { Dimension } from "../dimension";
import { Serenity } from "../../serenity";
import {
  EntityEntry,
  PlayerEntry,
  WorldProperties,
  WorldProviderProperties
} from "../../types";
import { World } from "../world";
import { Entity } from "../../entity";
import { WorldInitializeSignal } from "../../events";

import { WorldProvider } from "./provider";

class LevelDBProvider extends WorldProvider {
  public static readonly identifier: string = "leveldb";

  /**
   * The database instance for the provider.
   */
  public readonly db: Leveldb;

  /**
   * The loaded chunks in the provider.
   */
  public readonly chunks = new Map<Dimension, Map<bigint, Chunk>>();

  public constructor(path: string) {
    super();

    // Open the database for the provider
    this.db = Leveldb.open(resolve(path, "db"));
  }

  public onShutdown(): void {
    // Save all the world data.
    this.onSave();

    // Close the database connection.
    this.db.close();
  }

  public onStartup(): void {
    // Iterate through the dimensions and load the entities.
    for (const dimension of this.world.dimensions.values()) {
      // Get the available entities for the dimension.
      const entities = this.readAvailableEntities(dimension);

      // Check if the entities are empty.
      if (entities.length === 0) continue;

      // Iterate through the entities and load them.
      for (const uniqueId of entities) {
        // Read the entity from the database.
        const entry = this.readEntity(uniqueId, dimension);

        // Create a new entity instance.
        const entity = new Entity(dimension, entry.identifier, {
          uniqueId,
          entry
        });

        // Add the entity to the dimension.
        entity.spawn();
      }
    }
  }

  public onSave(): void {
    // Iterate through the chunks and write them to the database.
    for (const [dimension, chunks] of this.chunks) {
      // Iterate through the chunks and write them to the database.
      for (const chunk of chunks.values()) this.writeChunk(chunk, dimension);

      // Iterate through the entities and write them to the database.
      const entities = [...dimension.entities.values()];
      const uniqueIds: Array<bigint> = [];
      for (const entity of entities) {
        // Check if the entity is a player.
        if (entity.isPlayer())
          this.writePlayer(entity.getDataEntry(), dimension);
        else {
          // Write the entity to the database.
          this.writeEntity(entity.getDataEntry(), dimension);

          // Add the unique identifier to the list.
          uniqueIds.push(entity.uniqueId);
        }
      }

      // Write the available entities to the database.
      this.writeAvailableEntities(dimension, uniqueIds);

      for (const block of dimension.blocks.values()) {
        console.log(block.getType().identifier);
      }
    }
  }

  public readChunk(cx: number, cz: number, dimension: Dimension): Chunk {
    // Check if the chunks contain the dimension.
    if (!this.chunks.has(dimension)) {
      this.chunks.set(dimension, new Map());
    }

    // Get the dimension chunks.
    const chunks = this.chunks.get(dimension) as Map<bigint, Chunk>;

    // Generate a hash for the chunk coordinates.
    const hash = ChunkCoords.hash({ x: cx, z: cz });

    // Check if the cache contains the chunk.
    if (chunks.has(hash)) {
      return chunks.get(hash) as Chunk;
    } else if (this.hasChunk(cx, cz, dimension)) {
      // Create an array of subchunks.
      const subchunks = new Array<SubChunk>();

      // Iterate through the subchunks and read them from the database.
      // TODO: Dimensions can have a data driven min and max subchunk value, we should use that.
      for (let cy = -4; cy < 16; cy++) {
        // Read and push the subchunk to the subchunks array.
        subchunks.push(this.readSubChunk(cx, cy, cz, dimension));
      }

      // Create a new chunk instance.
      const chunk = new Chunk(cx, cz, dimension.type, subchunks);

      // Add the chunk to the cache.
      chunks.set(hash, chunk);

      // Return the chunk.
      return chunk;
    } else {
      // Generate a new chunk if it does not exist.
      const chunk = dimension.generator.apply(cx, cz, dimension.type);

      // Add the chunk to the cache.
      chunks.set(hash, chunk);

      // Return the generated chunk.
      return chunk;
    }
  }

  public writeChunk(chunk: Chunk, dimension: Dimension): void {
    // Check if the chunk is empty.
    if (chunk.isEmpty() || !chunk.dirty) return;

    // Write the chunk version, in this case will be 40
    this.writeChunkVersion(chunk.x, chunk.z, dimension, 40);

    // Iterate through the chunks and write them to the database.
    // TODO: Dimensions can have a data driven min and max subchunk value, we should use that.
    for (let cy = -4; cy < 16; cy++) {
      // Get the subchunk from the chunk.
      const subchunk = chunk.getSubChunk(cy + 4);

      // Check if the subchunk is empty.
      if (!subchunk || subchunk.isEmpty()) continue;

      // Write the subchunk to the database.
      this.writeSubChunk(subchunk, chunk.x, cy, chunk.z, dimension);
    }

    // Set the chunk as not dirty.
    chunk.dirty = false;
  }

  /**
   * Write the chunk version to the database.
   * @param cx The chunk X coordinate.
   * @param cz The chunk Z coordinate.
   * @param index The dimension index.
   * @param version The chunk version.
   */
  public writeChunkVersion(
    cx: number,
    cz: number,
    dimension: Dimension,
    version: number
  ): void {
    // Create a key for the chunk version
    const key = LevelDBProvider.buildChunkVersionKey(
      cx,
      cz,
      dimension.indexOf()
    );

    // Write the chunk version to the database.
    this.db.put(key, Buffer.from([version]));
  }

  /**
   * Checks if the database has a chunk.
   * @param cx The chunk X coordinate.
   * @param cz The chunk Z coordinate.
   * @param dimension The dimension to check for the chunk.
   */
  public hasChunk(cx: number, cz: number, dimension: Dimension): boolean {
    try {
      // Create a key for the chunk version.
      const key = LevelDBProvider.buildChunkVersionKey(
        cx,
        cz,
        dimension.indexOf()
      );

      // Check if the key exists in the database.
      const data = this.db.get(key);
      if (data) return true;

      // Return false if the chunk does not exist.
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Reads a subchunk from the database.
   * @param cx The chunk X coordinate.
   * @param cy The subchunk Y coordinate.
   * @param cz The chunk Z coordinate.
   * @param dimension The dimension to read the subchunk from.
   * @returns The subchunk from the database.
   */
  public readSubChunk(
    cx: number,
    cy: number,
    cz: number,
    dimension: Dimension
  ): SubChunk {
    // Attempt to read the subchunk from the database.
    try {
      // Build the subchunk key for the database.
      const key = LevelDBProvider.buildSubChunkKey(
        cx,
        cy,
        cz,
        dimension.indexOf()
      );

      // Deserialize the subchunk from the database.
      const subchunk = SubChunk.from(this.db.get(key), true);

      // Set the chunk y coordinate of the subchunk.
      subchunk.index = cy;

      // Return the subchunk from the database.
      return subchunk;
    } catch {
      // If an error occurs, return a new subchunk.
      // These means the subchunk does not exist.
      const subchunk = new SubChunk();

      // Set the chunk y coordinate of the subchunk.
      subchunk.index = cy;

      // Return the new subchunk.
      return subchunk;
    }
  }

  /**
   * Writes a subchunk to the database.
   * @param subchunk The subchunk to write.
   * @param cx The chunk X coordinate.
   * @param cy The subchunk Y coordinate.
   * @param cz The chunk Z coordinate.
   * @param dimension The dimension to write the subchunk to.
   */
  public writeSubChunk(
    subchunk: SubChunk,
    cx: number,
    cy: number,
    cz: number,
    dimension: Dimension
  ): void {
    // Create a key for the subchunk.
    const key = LevelDBProvider.buildSubChunkKey(
      cx,
      cy,
      cz,
      dimension.indexOf()
    );

    // Set the subchunk index.
    subchunk.index = cy;

    // Serialize the subchunk to a buffer
    const stream = new BinaryStream();
    SubChunk.serialize(subchunk, stream, true);

    // Write the subchunk to the database
    this.db.put(key, stream.getBuffer());
  }

  public readAvailableEntities(dimension: Dimension): Array<bigint> {
    // Prepare an array to store the entities unique identifiers.
    const uniqueIds = new Array<bigint>();

    // Attempt to read the entities from the database.
    try {
      // Create a key for the actor list.
      const key = LevelDBProvider.buildActorListKey(dimension);

      // Create a new BinaryStream instance.
      const stream = new BinaryStream(this.db.get(key));

      // Read the unique identifiers from the stream.
      do uniqueIds.push(stream.readInt64(Endianness.Little));
      while (!stream.cursorAtEnd());

      // Return the unique identifiers.
      return uniqueIds;
    } catch {
      // If an error occurs, return an empty array.
      return uniqueIds;
    }
  }

  public writeAvailableEntities(
    dimension: Dimension,
    entities: Array<bigint>
  ): void {
    // Create a key for the actor list.
    const key = LevelDBProvider.buildActorListKey(dimension);

    // Create a new BinaryStream instance.
    const stream = new BinaryStream();

    // Write the unique identifiers to the stream.
    for (const uniqueId of entities)
      stream.writeInt64(uniqueId, Endianness.Little);

    // Write the stream to the database.
    this.db.put(key, stream.getBuffer());
  }

  public readEntity(uniqueId: bigint, dimension: Dimension): EntityEntry {
    // Get all the available entities for the dimension.
    const entities = this.readAvailableEntities(dimension);

    // Check if the entity exists.
    if (!entities.includes(uniqueId)) {
      throw new Error(`Entity with unique id ${uniqueId} not found!`);
    }

    // Create a key for the entity.
    const key = LevelDBProvider.buildActorDataKey(uniqueId);

    // Read the entity data from the database.
    const buffer = this.db.get(key);

    // Parse the entity data from the buffer.
    const data = JSON.parse(buffer.toString(), (_, value) => {
      if (typeof value === "string" && value.endsWith("BigInt_t")) {
        return BigInt(value.slice(0, -8));
      }

      if (value === "Infinity_t") return Infinity;
      if (value === "-Infinity_t") return -Infinity;
      if (value === "NaN_t") return Number.NaN;

      return value;
    }) as EntityEntry;

    // Return the entity data.
    return data;
  }

  public writeEntity(entity: EntityEntry, dimension: Dimension): void {
    // Get all the available entities for the dimension.
    const entities = this.readAvailableEntities(dimension);

    // Check if the entity already exists.
    if (!entities.includes(entity.uniqueId)) entities.push(entity.uniqueId);

    // Write the entity to the database.
    const data = JSON.stringify(entity, (_, value) => {
      if (typeof value === "bigint") return value.toString() + "BigInt_t";
      if (value === Infinity) return "Infinity_t";
      if (value === -Infinity) return "-Infinity_t";
      if (Number.isNaN(value)) return "NaN_t";

      return value;
    });

    // Convert the entity data to a buffer.
    const buffer = Buffer.from(data);

    // Create a key for the entity.
    const key = LevelDBProvider.buildActorDataKey(entity.uniqueId);

    // Write the entity data to the database.
    this.db.put(key, buffer);
  }

  public readPlayer(uuid: string, dimension: Dimension): PlayerEntry | null {
    // Attempt to read the player from the database.
    try {
      // Create a key for the player.
      const key = `player_server_${uuid}_${dimension.identifier}`;

      // Read the player data from the database.
      const buffer = this.db.get(Buffer.from(key));

      // Parse the player data from the buffer.
      const data = JSON.parse(buffer.toString(), (_, value) => {
        if (typeof value === "string" && value.endsWith("BigInt_t")) {
          return BigInt(value.slice(0, -8));
        }

        if (value === "Infinity_t") return Infinity;
        if (value === "-Infinity_t") return -Infinity;
        if (value === "NaN_t") return Number.NaN;

        return value;
      }) as PlayerEntry;

      // Return the player data.
      return data;
    } catch {
      return null;
    }
  }

  public writePlayer(player: PlayerEntry, dimension: Dimension): void {
    // We want to stringify the player data and write it to the database.
    // So we need a custom serialization method for bigints, as JSON.stringify does not support them.
    // Same goes for Infinity, -Infinity and NaN, but we don't have to worry about those here.
    const data = JSON.stringify(player, (_, value) => {
      if (typeof value === "bigint") return value.toString() + "BigInt_t";
      if (value === Infinity) return "Infinity_t";
      if (value === -Infinity) return "-Infinity_t";
      if (Number.isNaN(value)) return "NaN_t";

      return value;
    });

    // Convert the player data to a buffer.
    const buffer = Buffer.from(data);

    // Create a key for the player.
    const key = `player_server_${player.uuid}_${dimension.identifier}`;

    // Write the player data to the database.
    this.db.put(Buffer.from(key), buffer);
  }

  public static initialize(
    serenity: Serenity,
    properties: WorldProviderProperties
  ): void {
    // Resolve the path for the worlds directory.
    const path = resolve(properties.path);

    // Check if the path provided exists.
    // If it does not exist, create the directory.
    if (!existsSync(path)) mkdirSync(path);

    // Read all the directories in the world directory.
    // Excluding file types, as a world entry is a directory.
    const directories = readdirSync(path, { withFileTypes: true }).filter(
      (dirent) => dirent.isDirectory()
    );

    // Check if the directory is empty.
    // If it is, create a new world with the default identifier.
    if (directories.length === 0)
      return void this.create(serenity, properties, { identifier: "default" });

    // Iterate over the world entries in the directory.
    for (const directory of directories) {
      // Get the path for the world.
      const worldPath = resolve(path, directory.name);

      // Get the world properties.
      let properties: Partial<WorldProperties> = { identifier: directory.name };
      if (existsSync(resolve(worldPath, "properties.json"))) {
        // Read the properties of the world.
        properties = JSON.parse(
          readFileSync(resolve(worldPath, "properties.json"), "utf-8")
        );
      }

      // Create a new world instance.
      const world = new World(serenity, new this(worldPath), properties);

      // Assign the world to the provider.
      world.provider.world = world;

      // Write the properties to the world.
      writeFileSync(
        resolve(worldPath, "properties.json"),
        JSON.stringify(world.properties, null, 2)
      );

      // Register the world with the serenity instance.
      serenity.registerWorld(world);

      // Create a new WorldInitializedSignal instance.
      new WorldInitializeSignal(world).emit();
    }
  }

  public static create(
    serenity: Serenity,
    properties: WorldProviderProperties,
    worldProperties?: Partial<WorldProperties>
  ): World {
    // Resolve the path for the worlds directory.
    const path = resolve(properties.path);

    // Check if the path provided exists.
    // If it does not exist, create the directory.
    if (!existsSync(path)) mkdirSync(path);

    // Check if a world identifier was provided.
    if (!worldProperties?.identifier)
      throw new Error("A world identifier is required to create a new world.");

    // Get the world path from the properties.
    const worldPath = resolve(path, worldProperties.identifier);

    // Check if the world already exists.
    if (existsSync(worldPath))
      throw new Error(
        `World with identifier ${worldProperties.identifier} already exists in the directory.`
      );

    // Create the world directory.
    mkdirSync(worldPath);

    // Create a new world instance.
    const world = new World(serenity, new this(worldPath), worldProperties);

    // Assign the world to the provider.
    world.provider.world = world;

    // Create the properties file for the world.
    writeFileSync(
      resolve(worldPath, "properties.json"),
      JSON.stringify(world.properties, null, 2)
    );

    // Create a new WorldInitializedSignal instance.
    new WorldInitializeSignal(world).emit();

    // Return the created world.
    return world;
  }

  /**
   * Build a subchunk key for the database.
   * @param cx The chunk X coordinate.
   * @param cy The subchunk Y coordinate.
   * @param cz The chunk Z coordinate.
   * @param index The dimension index.
   * @returns The buffer key for the subchunk
   */
  public static buildSubChunkKey(
    cx: number,
    cy: number,
    cz: number,
    index: number
  ): Buffer {
    // Create a new BinaryStream instance.
    const stream = new BinaryStream();

    // Write the chunk coordinates to the stream.
    stream.writeInt32(cx, Endianness.Little);
    stream.writeInt32(cz, Endianness.Little);

    // Check if the index is not 0.
    if (index !== 0) stream.writeInt32(index, Endianness.Little);

    // Write the query key to the stream.
    stream.writeByte(0x2f);

    // Write the subchunk index to the stream.
    stream.writeByte(cy);

    // Return the buffer from the stream.
    return stream.getBuffer();
  }

  /**
   * Build a chunk version key for the database.
   * @param cx The chunk X coordinate.
   * @param cz The chunk Z coordinate.
   * @param index The dimension index.
   * @returns The buffer key for the chunk version
   */
  public static buildChunkVersionKey(
    cx: number,
    cz: number,
    index: number
  ): Buffer {
    // Create a new BinaryStream instance.
    const stream = new BinaryStream();

    // Write the chunk coordinates to the stream.
    stream.writeInt32(cx, Endianness.Little);
    stream.writeInt32(cz, Endianness.Little);

    // Check if the index is not 0.
    if (index !== 0) {
      stream.writeInt32(index, Endianness.Little);
    }

    // Write the chunk version byte to the stream.
    stream.writeByte(0x2c);

    // Return the buffer from the stream
    return stream.getBuffer();
  }

  /**
   * Read the actor list key for the database.
   * @param dimension The dimension to read the actor list key for.
   * @returns The buffer key for the actor list
   */
  public static buildActorListKey(dimension: Dimension) {
    // Create a new BinaryStream instance.
    const stream = new BinaryStream();

    // Write the key symbol to the stream
    stream.writeInt32(0x64_69_67_70);

    // Check if the index is not 0.
    if (dimension.indexOf() !== 0)
      stream.writeInt32(dimension.indexOf(), Endianness.Little);

    // Return the buffer from the stream.
    return stream.getBuffer();
  }

  /**
   * Build an actor data key for the database.
   * @param uniqueId The unique identifier of the actor.
   * @returns The buffer key for the actor data
   */
  public static buildActorDataKey(uniqueId: bigint): Buffer {
    // Create a new BinaryStream instance.
    const stream = new BinaryStream();

    // Write the key symbol to the stream.
    stream.writeBuffer(Buffer.from("actorprefix", "ascii"));

    // Write the unique identifier to the stream.
    stream.writeInt64(uniqueId, Endianness.Little);

    // Return the buffer from the stream.
    return stream.getBuffer();
  }
}

export { LevelDBProvider };
