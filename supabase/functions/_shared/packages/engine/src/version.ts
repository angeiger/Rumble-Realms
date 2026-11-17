// Bump when a fight result can change for identical input (D-006). Stored with every match.
// Since version 4 it also covers the bot's decisions: client and server must choose the same
// bot pick for the same state and seed (`botPickRng`, D-084), so any change to a bot strategy,
// its data or its random stream needs a new version as well.
export const ENGINE_VERSION = 4;
