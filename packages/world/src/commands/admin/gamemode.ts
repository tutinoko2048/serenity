import { Gamemode, PermissionLevel } from "@serenityjs/protocol";
import { StringEnum } from "@serenityjs/command";

import { TargetEnum } from "../enums";
import { Player } from "../../player";

import type { World } from "../../world";

const register = (world: World) => {
	// Register the about command
	world.commands.register(
		"gamemode",
		"Sets a player's gamemode",
		(origin, parameters) => {
			// Get the result of the mode and player
			const mode = parameters.mode.result.toLowerCase();
			const target = parameters.target?.result;

			// Check if the player is not undefined
			if (!target && !(origin instanceof Player)) {
				throw new Error("Player must be specified");
			} else if (!target && origin instanceof Player) {
				switch (mode) {
					default: {
						throw new TypeError("Invalid gamemode specified!");
					}

					// Update the player's gamemode to survival
					case "s":
					case "survival": {
						origin.gamemode = Gamemode.Survival;

						// Return the success message
						return {
							message: "Successfully set your gamemode to Survival!"
						};
					}

					// Update the player's gamemode to creative
					case "c":
					case "creative": {
						origin.gamemode = Gamemode.Creative;

						// Return the success message
						return {
							message: "Successfully set your gamemode to Creative!"
						};
					}

					// Update the player's gamemode to adventure
					case "a":
					case "adventure": {
						origin.gamemode = Gamemode.Adventure;

						// Return the success message
						return {
							message: "Successfully set your gamemode to Adventure!"
						};
					}

					// Update the player's gamemode to spectator
					case "sp":
					case "spectator": {
						origin.gamemode = Gamemode.Spectator;

						// Return the success message
						return {
							message: "Successfully set your gamemode to Spectator!"
						};
					}
				}
			} else {
				switch (mode) {
					default: {
						throw new TypeError("Invalid gamemode specified!");
					}

					// Update the player's gamemode to survival
					case "s":
					case "survival": {
						// Loop through all the players
						// Return the success message
						for (const entity of target) {
							// Check if the entity is a player
							if (!(entity instanceof Player)) continue;

							// Update the player's gamemode to survival
							entity.gamemode = Gamemode.Survival;
						}

						return {
							message: `Successfully set ${target.length} player's gamemode to Survival!`
						};
					}

					// Update the player's gamemode to creative
					case "c":
					case "creative": {
						// Loop through all the players
						// Return the success message
						for (const entity of target) {
							// Check if the entity is a player
							if (!(entity instanceof Player)) continue;

							// Update the player's gamemode to creative
							entity.gamemode = Gamemode.Creative;
						}

						return {
							message: `Successfully set ${target.length} player's gamemode to Creative!`
						};
					}

					// Update the player's gamemode to adventure
					case "a":
					case "adventure": {
						// Loop through all the players
						// Return the success message
						for (const entity of target) {
							// Check if the entity is a player
							if (!(entity instanceof Player)) continue;

							// Update the player's gamemode to adventure
							entity.gamemode = Gamemode.Adventure;
						}

						return {
							message: `Successfully set ${target.length} player's gamemode to Adventure!`
						};
					}

					// Update the player's gamemode to spectator
					case "sp":
					case "spectator": {
						// Loop through all the players
						// Return the success message
						for (const entity of target) {
							// Check if the entity is a player
							if (!(entity instanceof Player)) continue;

							// Update the player's gamemode to spectator
							entity.gamemode = Gamemode.Spectator;
						}

						return {
							message: `Successfully set ${target.length} player's gamemode to Spectator!`
						};
					}
				}
			}
		},
		{
			mode: StringEnum,
			target: [TargetEnum, true]
		},
		{
			permission: PermissionLevel.Operator
		}
	);
};

export default register;
