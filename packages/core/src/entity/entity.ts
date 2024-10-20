import {
  ContainerName,
  MoveActorDeltaPacket,
  MoveDeltaFlags,
  Rotation,
  SetActorMotionPacket,
  Vector3f
} from "@serenityjs/protocol";

import { Dimension, World } from "../world";
import { EntityIdentifier } from "../enums";
import { EntityEntry, EntityProperties, JSONLikeValue } from "../types";
import { Serenity } from "../serenity";
import { Chunk } from "../world/chunk";
import { Container } from "../container";
import { ItemStack } from "../item";

import { EntityType } from "./identity";
import { EntityInventoryTrait, EntityTrait } from "./traits";
import { Player } from "./player";
import { MetadataMap, ActorFlagMap, AttributeMap } from "./maps";

class Entity {
  /**
   * The running total of entities that have been created
   */
  public static runtimeId = 0n;

  /**
   * The serenity instance of the server
   */
  protected readonly serenity: Serenity;

  /**
   * The type of the entity. (Identifier, NetworkId, etc)
   */
  public readonly type: EntityType;

  /**
   * The current runtime id of the entity. (Incremented each time an entity is created)
   */
  public readonly runtimeId = ++Entity.runtimeId;

  /**
   * The unique id of the entity. (Generated by the server, and exists for the lifetime of the entity)
   */
  public readonly uniqueId: bigint;

  /**
   * The current position of the entity
   */
  public readonly position = new Vector3f(0, 0, 0);

  /**
   * The current velocity of the entity
   */
  public readonly velocity = new Vector3f(0, 0, 0);

  /**
   * The current rotation of the entity
   */
  public readonly rotation = new Rotation(0, 0, 0);

  /**
   * The traits that are attached to the entity
   */
  public readonly traits = new Map<string, EntityTrait>();

  /**
   * The components that are attached to the entity
   */
  public readonly components = new Map<string, JSONLikeValue>();

  /**
   * The metadata that is attached to the entity
   * These values are derived from the components and traits of the entity
   */
  public readonly metadata = new MetadataMap(this);

  /**
   * The flags that are attached to the entity
   * These values are derived from the components and traits of the entity
   */
  public readonly flags = new ActorFlagMap(this);

  /**
   * The attributes that are attached to the entity
   * These values are derived from the components and traits of the entity
   */
  public readonly attributes = new AttributeMap(this);

  /**
   * The current dimension of the entity.
   * This should not be dynamically changed, but instead use the `teleport` method.
   */
  public dimension: Dimension;

  /**
   * Whether the entity is alive or not.
   */
  public isAlive = false;

  /**
   * Whether the entity is on the ground or not.
   */
  public onGround = false;

  /**
   * Creates a new entity within a dimension.
   * @param dimension The dimension to create the entity in
   * @param type The type of the entity to create
   * @param properties Additional properties to assign to the entity
   */
  public constructor(
    dimension: Dimension,
    type: EntityType | EntityIdentifier,
    properties?: Partial<EntityProperties>
  ) {
    // Assign the serenity instance to the entity
    this.serenity = dimension.world.serenity;

    // Assign the dimension and type to the entity
    this.dimension = dimension;
    this.type =
      type instanceof EntityType ? type : (EntityType.get(type) as EntityType); // TODO: Fix this, fetch from the palette

    // Assign the properties to the entity
    // If a provided unique id is not given, generate one
    this.uniqueId = !properties?.uniqueId
      ? Entity.createUniqueId(this.type.network, this.runtimeId)
      : properties.uniqueId;

    // If the entity is not a player
    if (!this.isPlayer()) {
      // If the entity properties contains an entry, load it
      if (properties?.entry) this.load(properties.entry);

      // Get the traits for the entity
      const traits = dimension.world.entityPalette.getRegistryFor(
        this.type.identifier
      );

      // Register the traits to the entity
      for (const trait of traits) this.addTrait(trait);
    }
  }

  /**
   * Checks if the entity is a player.
   * @returns Whether or not the entity is a player.
   */
  public isPlayer(): this is Player {
    return this.type.identifier === EntityIdentifier.Player;
  }

  /**
   * Checks if the entity is an item.
   * @returns Whether or not the entity is an item.
   */
  public isItem(): boolean {
    return this.type.identifier === EntityIdentifier.Item;
  }

  /**
   * Whether the entity has the specified trait.
   * @param trait The trait to check for
   * @returns Whether the entity has the trait
   */
  public hasTrait(trait: string | typeof EntityTrait): boolean {
    return this.traits.has(
      typeof trait === "string" ? trait : trait.identifier
    );
  }

  /**
   * Gets the specified trait from the entity.
   * @param trait The trait to get from the entity
   * @returns The trait if it exists, otherwise null
   */
  public getTrait<T extends typeof EntityTrait>(trait: T): InstanceType<T>;

  /**
   * Gets the specified trait from the entity.
   * @param trait The trait to get from the entity
   * @returns The trait if it exists, otherwise null
   */
  public getTrait(trait: string): EntityTrait | null;

  /**
   * Gets the specified trait from the entity.
   * @param trait The trait to get from the entity
   * @returns The trait if it exists, otherwise null
   */
  public getTrait(trait: string | typeof EntityTrait): EntityTrait | null {
    return this.traits.get(
      typeof trait === "string" ? trait : trait.identifier
    ) as EntityTrait | null;
  }

  /**
   * Removes the specified trait from the entity.
   * @param trait The trait to remove
   */
  public removeTrait(trait: string | typeof EntityTrait): void {
    this.traits.delete(typeof trait === "string" ? trait : trait.identifier);
  }

  /**
   * Adds a trait to the entity.
   * @param trait The trait to add
   * @returns The trait that was added
   */
  public addTrait(trait: typeof EntityTrait): void {
    // Check if the trait already exists
    if (this.traits.has(trait.identifier)) return;

    // Check if the trait is in the palette
    if (!this.getWorld().entityPalette.traits.has(trait.identifier))
      this.getWorld().logger.warn(
        `Trait "§c${trait.identifier}§r" was added to entity "§d${this.type.identifier}§r:§d${this.uniqueId}§r" in dimension "§a${this.dimension.identifier}§r" but does not exist in the palette. This may result in a deserilization error.`
      );

    // Attempt to add the trait to the entity
    try {
      // Create a new instance of the trait
      new trait(this);
    } catch (reason) {
      // Log the error to the console
      this.serenity.logger.error(
        `Failed to add trait "${trait.identifier}" to entity "${this.type.identifier}:${this.uniqueId}" in dimension "${this.dimension.identifier}"`,
        reason
      );
    }
  }

  /**
   * Gets the world the entity is currently in.
   * @returns The world the entity is in
   */
  public getWorld(): World {
    return this.dimension.world;
  }

  /**
   * Gets the chunk the entity is currently in.
   * @returns The chunk the entity is in
   */
  public getChunk(): Chunk {
    // Convert the position to a chunk position
    const cx = this.position.x >> 4;
    const cz = this.position.z >> 4;

    // Get the chunk from the dimension
    return this.dimension.getChunk(cx, cz);
  }

  /**
   * Gets the item the entity is currently holding.
   * @returns The item the entity is holding
   */
  public getHeldItem(): ItemStack | null {
    // Check if the entity has an inventory trait
    if (!this.hasTrait(EntityInventoryTrait)) return null;

    // Get the inventory trait
    const inventory = this.getTrait(EntityInventoryTrait);

    // Return the held item
    return inventory.getHeldItem();
  }

  /**
   * Spawns the entity into the dimension.
   */
  public spawn(): void {
    // Add the entity to the dimension
    this.dimension.entities.set(this.uniqueId, this);

    // Set the entity as alive
    this.isAlive = true;

    // Trigger the entity onSpawn trait event
    for (const trait of this.traits.values()) {
      // Attempt to trigger the onSpawn trait event
      try {
        // Call the onSpawn trait event
        trait.onSpawn?.();
      } catch (reason) {
        // Log the error to the console
        this.serenity.logger.error(
          `Failed to trigger onSpawn trait event for entity "${this.type.identifier}:${this.uniqueId}" in dimension "${this.dimension.identifier}"`,
          reason
        );

        // Remove the trait from the entity
        this.traits.delete(trait.identifier);
      }
    }

    // Update the entity actor data & attributes
    this.metadata.update();
    this.attributes.update();
  }

  /**
   * Despawns the entity from the dimension.
   */
  public despawn(): void {
    // Set the entity as not alive
    this.isAlive = false;

    // Remove the entity from the dimension
    this.dimension.entities.delete(this.uniqueId);

    // Trigger the entity onDespawn trait event
    for (const trait of this.traits.values()) {
      // Attempt to trigger the onDespawn trait event
      try {
        // Call the onDespawn trait event
        trait.onDespawn?.();
      } catch (reason) {
        // Log the error to the console
        this.serenity.logger.error(
          `Failed to trigger onDespawn trait event for entity "${this.type.identifier}:${this.uniqueId}" in dimension "${this.dimension.identifier}"`,
          reason
        );

        // Remove the trait from the entity
        this.traits.delete(trait.identifier);
      }
    }
  }

  /**
   * Get a container from the entity.
   * @param name The name of the container.
   */
  public getContainer(name: ContainerName): Container | null {
    // Switch name of the container
    switch (name) {
      default: {
        // Return null if the container name is not valid
        return null;
      }

      // case ContainerName.Armor: {
      //   // Check if the entity has an inventory component
      //   if (!this.hasComponent("minecraft:inventory"))
      //     throw new Error("The entity does not have an inventory component.");

      //   // Get the inventory component
      //   const inventory = this.getComponent("minecraft:inventory");

      //   // Return the armor container
      //   return inventory.container;
      // }

      case ContainerName.Hotbar:
      case ContainerName.Inventory:
      case ContainerName.HotbarAndInventory: {
        // Check if the entity has an inventory trait
        if (!this.hasTrait(EntityInventoryTrait))
          throw new Error("The entity does not have an inventory trait.");

        // Get the inventory trait
        const inventory = this.getTrait(EntityInventoryTrait);

        // Return the inventory container
        return inventory.container;
      }
    }
  }

  /**
   * Sets the position of the entity.
   * @param vector The position to set.
   */
  public setMotion(vector?: Vector3f): void {
    // Update the velocity of the entity
    this.velocity.x = vector?.x ?? this.velocity.x;
    this.velocity.y = vector?.y ?? this.velocity.y;
    this.velocity.z = vector?.z ?? this.velocity.z;

    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;
    this.position.z += this.velocity.z;

    // Set the onGround property of the entity
    this.onGround = false;

    // Create a new SetActorMotionPacket
    const packet = new SetActorMotionPacket();

    // Set the properties of the packet
    packet.runtimeId = this.runtimeId;
    packet.motion = this.velocity;
    packet.tick = this.dimension.world.currentTick;

    // Broadcast the packet to the dimension
    this.dimension.broadcast(packet);
  }

  /**
   * Adds motion to the entity.
   * @param vector The motion to add.
   */
  public addMotion(vector: Vector3f): void {
    // Update the velocity of the entity
    this.velocity.x += vector.x;
    this.velocity.y += vector.y;
    this.velocity.z += vector.z;

    // Set the motion of the entity
    this.setMotion();
  }

  /**
   * Clears the motion of the entity.
   */
  public clearMotion(): void {
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;

    // Set the motion of the entity
    this.setMotion();
  }

  /**
   * Applies an impulse to the entity.
   * @param vector The impulse to apply.
   */
  public applyImpulse(vector: Vector3f): void {
    // Update the velocity of the entity
    this.velocity.x += vector.x;
    this.velocity.y += vector.y;
    this.velocity.z += vector.z;

    // Set the motion of the entity
    this.setMotion();
  }

  public teleport(position: Vector3f, dimension?: Dimension): void {
    // Set the position of the entity
    this.position.x = position.x;
    this.position.y = position.y;
    this.position.z = position.z;

    // Check if a dimension was provided
    if (dimension) {
      // Despawn the entity from the current dimension
      this.despawn();

      // Set the dimension of the entity
      this.dimension = dimension;

      // Spawn the entity in the new dimension
      this.spawn();
    } else {
      // Create a new MoveActorDeltaPacket
      const packet = new MoveActorDeltaPacket();

      // Adjust the y position of the entity
      const yAdjust =
        this.type.identifier === EntityIdentifier.Item ? 0 : -0.25;

      // Assign the packet properties
      packet.runtimeId = this.runtimeId;
      packet.flags = MoveDeltaFlags.All;
      packet.x = this.position.x;
      packet.y = this.position.y + yAdjust;
      packet.z = this.position.z;
      packet.yaw = this.rotation.yaw;
      packet.headYaw = this.rotation.headYaw;
      packet.pitch = this.rotation.pitch;

      // Check if the entity is on the ground
      if (this.onGround) packet.flags |= MoveDeltaFlags.OnGround;

      // Broadcast the packet to the dimension
      this.dimension.broadcast(packet);
    }
  }

  /**
   * Forces the entity to drop an item from its inventory.
   * @param slot The slot to drop the item from.
   * @param amount The amount of items to drop.
   * @param container The container to drop the item from.
   * @returns Whether or not the item was dropped.
   */
  public dropItem(slot: number, amount: number, container: Container): boolean {
    // Check if the entity has an inventory trait
    if (!this.hasTrait(EntityInventoryTrait)) return false;

    // Get the item from the slot
    const item = container.takeItem(slot, amount);

    // Check if the item is valid
    if (!item) return false;

    // Get the entity's position and rotation
    const { x, y, z } = this.position;
    const { headYaw, pitch } = this.rotation;

    // Normalize the pitch & headYaw, so the entity will be spawned in the correct direction
    const headYawRad = (headYaw * Math.PI) / 180;
    const pitchRad = (pitch * Math.PI) / 180;

    // Calculate the velocity of the entity based on the entity's rotation
    const velocity = new Vector3f(
      (-Math.sin(headYawRad) * Math.cos(pitchRad)) / 3,
      -Math.sin(pitchRad) / 2,
      (Math.cos(headYawRad) * Math.cos(pitchRad)) / 3
    );

    // Spawn the entity
    const entity = this.dimension.spawnItem(item, new Vector3f(x, y - 0.25, z));

    // Set the velocity of the entity
    entity.setMotion(velocity);

    // Return true as the item was dropped
    return true;
  }

  /**
   * Saves the entity to the current provider of the world the entity is in.
   */
  public save(): void {
    // Get the provider of the dimension
    const provider = this.dimension.world.provider;

    // Create the entity entry to save
    const entry: EntityEntry = {
      uniqueId: this.uniqueId,
      identifier: this.type.identifier,
      position: this.position,
      rotation: this.rotation,
      components: [...this.components.entries()],
      traits: [...this.traits.keys()],
      metadata: [...this.metadata.entries()],
      flags: [...this.flags.entries()],
      attributes: [...this.attributes.entries()]
    };

    // Write the entity to the provider
    provider.writeEntity(entry, this.dimension);
  }

  /**
   * Loads the entity from the provided entity entry.
   * @param entry The entity entry to load
   * @param overwrite Whether to overwrite the current entity data; default is true
   */
  public load(entry: EntityEntry, overwrite = true): void {
    // Check that the unique id matches the entity's unique id
    if (entry.uniqueId !== this.uniqueId)
      throw new Error(
        "Failed to load entity entry as the unique id does not match the entity's unique id!"
      );

    // Check that the identifier matches the entity's identifier
    if (entry.identifier !== this.type.identifier)
      throw new Error(
        "Failed to load entity entry as the identifier does not match the entity's identifier!"
      );

    // Set the entity's position and rotation
    this.position.set(entry.position);
    this.rotation.set(entry.rotation);

    // Check if the entity should overwrite the current data
    if (overwrite) {
      this.components.clear();
      this.traits.clear();
    }

    // Add the components to the entity, if it does not already exist
    for (const [key, value] of entry.components) {
      if (!this.components.has(key)) this.components.set(key, value);
    }

    // Add the traits to the entity, if it does not already exist
    for (const trait of entry.traits) {
      // Check if the palette has the trait
      const traitType = this.dimension.world.entityPalette.traits.get(trait);

      // Check if the trait exists in the palette
      if (!traitType) {
        this.serenity.logger.error(
          `Failed to load trait "${trait}" for entity "${this.type.identifier}:${this.uniqueId}" in dimension "${this.dimension.identifier}" as it does not exist in the palette`
        );

        continue;
      }

      // Attempt to add the trait to the entity
      this.addTrait(traitType);
    }

    // Add the metadata to the entity, if it does not already exist
    for (const [key, value] of entry.metadata) {
      if (!this.metadata.has(key)) this.metadata.set(key, value);
    }

    // Add the flags to the entity, if it does not already exist
    for (const [key, value] of entry.flags) {
      if (!this.flags.has(key)) this.flags.set(key, value);
    }

    // Add the attributes to the entity, if it does not already exist
    for (const [key, value] of entry.attributes) {
      if (!this.attributes.has(key)) this.attributes.set(key, value);
    }
  }

  /**
   * Creates a new unique id for the entity.
   * @param network The network id of the entity type
   * @param runtimeId The current runtime id of the entity
   * @returns A generated unique id for the entity
   */
  public static createUniqueId(network: number, runtimeId: bigint): bigint {
    // Generate a unique id for the entity
    const unique = BigInt(Math.abs(Date.now() >> 4) & 0x1_ff);

    return BigInt(network << 19) | (unique << 10n) | runtimeId;
  }
}

export { Entity };
