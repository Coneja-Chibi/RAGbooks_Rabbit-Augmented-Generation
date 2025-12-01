/**
 * ============================================================================
 * VECTHARE SCENE MARKERS
 * ============================================================================
 * Adds scene start/end marker buttons to chat messages. Scenes are stored as
 * chunks in the vector database with isScene:true metadata.
 *
 * Local state:
 * - cachedSceneChunks: scene chunks from vector DB (refreshed on chat load)
 * - pendingSceneStart: message index where user clicked START (not yet in DB)
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import {
    createSceneChunk,
    deleteSceneChunk,
    getCurrentCollectionId,
    filterSceneChunks,
} from '../core/scenes.js';
import { getSavedHashes } from '../core/core-vector-api.js';
import { eventSource, event_types } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const START_MARKER_CLASS = 'vecthare-scene-marker-start';
const END_MARKER_CLASS = 'vecthare-scene-marker-end';

const BOOKMARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M9.808 13.692h.884v-3h4.193L13.615 9l1.27-1.692H9.808zM6 19.5V4h12v15.5l-6-2.583z"/></svg>';

// ============================================================================
// LOCAL STATE
// ============================================================================

let cachedSceneChunks = [];
let pendingSceneStart = null;
let currentSettings = null;

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

/**
 * Refreshes the local cache of scene chunks from the vector DB
 */
export async function refreshSceneCache(settings) {
    if (settings) currentSettings = settings;

    const collectionId = getCurrentCollectionId();
    if (!collectionId || !currentSettings) {
        cachedSceneChunks = [];
        return;
    }

    try {
        const result = await getSavedHashes(collectionId, currentSettings, true);
        if (result.metadata) {
            cachedSceneChunks = result.metadata
                .filter(m => m.isScene === true)
                .map(m => ({
                    hash: m.hash,
                    sceneStart: m.sceneStart,
                    sceneEnd: m.sceneEnd,
                    containedHashes: m.containedHashes || [],
                    title: m.title || '',
                }));
        } else {
            cachedSceneChunks = [];
        }
        console.log(`VectHare Scenes: Cached ${cachedSceneChunks.length} scenes`);
    } catch (error) {
        console.error('VectHare Scenes: Failed to refresh cache', error);
        cachedSceneChunks = [];
    }
}

/**
 * Gets cached scenes (for external use)
 */
export function getCachedScenes() {
    return cachedSceneChunks;
}

/**
 * Gets pending scene start (for external use)
 */
export function getPendingSceneStart() {
    return pendingSceneStart;
}

/**
 * Sets the VectHare settings for scene operations
 */
export function setSceneSettings(settings) {
    currentSettings = settings;
}

// ============================================================================
// SCENE QUERY HELPERS
// ============================================================================

/**
 * Gets the scene chunk that contains a message
 * @param {number} msgId - Message index
 * @returns {object|null}
 */
function getSceneAtMessage(msgId) {
    return cachedSceneChunks.find(s =>
        msgId >= s.sceneStart && msgId <= s.sceneEnd,
    ) || null;
}

/**
 * Checks if a message is a scene start
 * @param {number} msgId - Message index
 * @returns {object|null} The scene chunk or null
 */
function getSceneStartingAt(msgId) {
    return cachedSceneChunks.find(s => s.sceneStart === msgId) || null;
}

/**
 * Checks if a message is a scene end
 * @param {number} msgId - Message index
 * @returns {object|null} The scene chunk or null
 */
function getSceneEndingAt(msgId) {
    return cachedSceneChunks.find(s => s.sceneEnd === msgId) || null;
}

// ============================================================================
// MARKER BUTTON CREATION
// ============================================================================

function createStartMarker() {
    const btn = document.createElement('div');
    btn.className = `mes_button ${START_MARKER_CLASS}`;
    btn.title = 'Mark scene START';
    btn.innerHTML = BOOKMARK_SVG;
    return btn;
}

function createEndMarker() {
    const btn = document.createElement('div');
    btn.className = `mes_button ${END_MARKER_CLASS}`;
    btn.title = 'Mark scene END';
    btn.innerHTML = BOOKMARK_SVG;
    return btn;
}

// ============================================================================
// MESSAGE PARSING
// ============================================================================

function getMessageId(messageElement) {
    const mesId = messageElement.getAttribute('mesid');
    if (mesId === null || mesId === undefined) return null;
    return parseInt(mesId, 10);
}

// ============================================================================
// MARKER ATTACHMENT
// ============================================================================

function attachMarkersToMessage(messageElement) {
    if (messageElement.querySelector(`.${START_MARKER_CLASS}`)) return;
    if (messageElement.classList.contains('system')) return;

    const messageId = getMessageId(messageElement);
    if (messageId === null) return;

    const mesButtons = messageElement.querySelector('.mes_buttons');
    if (!mesButtons) return;

    const startButton = createStartMarker();
    const endButton = createEndMarker();

    startButton.addEventListener('click', function(e) {
        e.stopPropagation();
        handleStartClick(messageId);
    });

    endButton.addEventListener('click', function(e) {
        e.stopPropagation();
        handleEndClick(messageId);
    });

    const firstButton = mesButtons.querySelector('.mes_button');
    if (firstButton) {
        mesButtons.insertBefore(endButton, firstButton);
        mesButtons.insertBefore(startButton, firstButton);
    } else {
        mesButtons.appendChild(startButton);
        mesButtons.appendChild(endButton);
    }

    updateMessageMarkerState(messageElement, messageId);
}

export function attachAllMarkers() {
    const messages = document.querySelectorAll('#chat .mes[mesid]');
    messages.forEach(msg => attachMarkersToMessage(msg));
}

export function removeAllMarkers() {
    document.querySelectorAll(`.${START_MARKER_CLASS}`).forEach(m => m.remove());
    document.querySelectorAll(`.${END_MARKER_CLASS}`).forEach(m => m.remove());
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * Updates marker visibility and state for a message
 */
function updateMessageMarkerState(messageElement, messageId) {
    const startButton = messageElement.querySelector(`.${START_MARKER_CLASS}`);
    const endButton = messageElement.querySelector(`.${END_MARKER_CLASS}`);

    const existingScene = getSceneAtMessage(messageId);
    const isExistingStart = getSceneStartingAt(messageId) !== null;
    const isExistingEnd = getSceneEndingAt(messageId) !== null;
    const isInPendingRange = pendingSceneStart !== null && messageId > pendingSceneStart;

    // START button visibility
    if (startButton) {
        // Always visible, but styled differently based on state
        startButton.style.display = '';
        startButton.classList.toggle('vecthare-active', isExistingStart);
        startButton.classList.toggle('vecthare-pending', pendingSceneStart === messageId);

        if (isExistingStart) {
            startButton.title = 'Delete this scene';
        } else if (pendingSceneStart === messageId) {
            startButton.title = 'Cancel pending scene';
        } else {
            startButton.title = 'Mark scene START';
        }
    }

    // END button visibility
    if (endButton) {
        // Only show if: pending exists AND this msg > pending start AND not inside existing scene
        const showEnd = pendingSceneStart !== null &&
                        messageId > pendingSceneStart &&
                        !existingScene;

        endButton.style.display = showEnd ? '' : 'none';
        endButton.title = 'Mark scene END';
    }

    // Visual indicators on message element
    messageElement.classList.remove('vecthare-in-scene', 'vecthare-scene-start', 'vecthare-scene-end', 'vecthare-pending-scene');

    if (existingScene) {
        messageElement.classList.add('vecthare-in-scene');
        if (existingScene.sceneStart === messageId) {
            messageElement.classList.add('vecthare-scene-start');
        }
        if (existingScene.sceneEnd === messageId) {
            messageElement.classList.add('vecthare-scene-end');
        }
    }

    if (pendingSceneStart !== null && messageId >= pendingSceneStart) {
        messageElement.classList.add('vecthare-pending-scene');
    }
}

export function updateAllMarkerStates() {
    const messages = document.querySelectorAll('#chat .mes[mesid]');
    messages.forEach(msg => {
        const messageId = getMessageId(msg);
        if (messageId !== null) {
            updateMessageMarkerState(msg, messageId);
        }
    });
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handles START button click
 */
async function handleStartClick(messageId) {
    if (!currentSettings) {
        toastr.error('VectHare settings not loaded');
        return;
    }

    const existingSceneStart = getSceneStartingAt(messageId);
    const existingSceneAt = getSceneAtMessage(messageId);

    // Case 1: Clicking on existing scene start - offer to delete
    if (existingSceneStart) {
        const confirmDelete = confirm(
            `Delete scene "${existingSceneStart.title || 'Untitled'}" (messages ${existingSceneStart.sceneStart}-${existingSceneStart.sceneEnd})?\n\nThis will re-enable the individual message chunks.`,
        );
        if (confirmDelete) {
            const result = await deleteSceneChunk(
                existingSceneStart.hash,
                existingSceneStart.containedHashes,
                currentSettings,
            );
            if (result.success) {
                toastr.success('Scene deleted');
                await refreshSceneCache();
                updateAllMarkerStates();
                eventSource.emit('vecthare_scenes_changed');
            } else {
                toastr.error(result.error || 'Failed to delete scene');
            }
        }
        return;
    }

    // Case 2: Clicking on pending start - cancel it
    if (pendingSceneStart === messageId) {
        pendingSceneStart = null;
        toastr.info('Pending scene cancelled');
        updateAllMarkerStates();
        return;
    }

    // Case 3: Inside existing scene - offer to split
    if (existingSceneAt && !existingSceneStart) {
        const confirmSplit = confirm(
            `This message is inside an existing scene (${existingSceneAt.sceneStart}-${existingSceneAt.sceneEnd}).\n\nSplit it? The existing scene will end at message ${messageId - 1}, and a new scene will start here.`,
        );
        if (confirmSplit) {
            // Delete old scene
            const deleteResult = await deleteSceneChunk(
                existingSceneAt.hash,
                existingSceneAt.containedHashes,
                currentSettings,
            );
            if (!deleteResult.success) {
                toastr.error('Failed to modify existing scene');
                return;
            }

            // Create shortened scene (if it would have at least 1 message)
            if (messageId - 1 >= existingSceneAt.sceneStart) {
                const createResult = await createSceneChunk(
                    existingSceneAt.sceneStart,
                    messageId - 1,
                    { title: existingSceneAt.title },
                    currentSettings,
                );
                if (!createResult.success) {
                    toastr.warning('Split scene created but shortened original failed');
                }
            }

            // Set pending start
            pendingSceneStart = messageId;
            toastr.success('Scene split. Mark the end of your new scene.');
            await refreshSceneCache();
            updateAllMarkerStates();
            eventSource.emit('vecthare_scenes_changed');
        }
        return;
    }

    // Case 4: Pending scene exists - offer to close it and start new
    if (pendingSceneStart !== null) {
        const confirmCloseAndStart = confirm(
            `You have a pending scene starting at message ${pendingSceneStart}.\n\nClose it at message ${messageId - 1} and start a new scene here?`,
        );
        if (confirmCloseAndStart) {
            // Create the pending scene
            const result = await createSceneChunk(
                pendingSceneStart,
                messageId - 1,
                {},
                currentSettings,
            );
            if (result.success) {
                toastr.success(`Scene created (${pendingSceneStart}-${messageId - 1})`);
                pendingSceneStart = messageId;
                toastr.info('New scene started. Mark the end.');
                await refreshSceneCache();
                updateAllMarkerStates();
                eventSource.emit('vecthare_scenes_changed');
            } else {
                toastr.error(result.error || 'Failed to create scene');
            }
        }
        return;
    }

    // Case 5: Normal start - just set pending
    pendingSceneStart = messageId;
    toastr.info('Scene started. Click END on another message to complete it.');
    updateAllMarkerStates();
}

/**
 * Handles END button click
 */
async function handleEndClick(messageId) {
    if (!currentSettings) {
        toastr.error('VectHare settings not loaded');
        return;
    }

    // No pending scene - shouldn't happen (button should be hidden)
    if (pendingSceneStart === null) {
        toastr.warning('No scene to close');
        return;
    }

    // End before start - shouldn't happen
    if (messageId <= pendingSceneStart) {
        toastr.warning('Scene end must be after start');
        return;
    }

    // Check if end point is inside an existing scene
    const existingSceneAt = getSceneAtMessage(messageId);
    if (existingSceneAt) {
        toastr.error(`Cannot end scene inside existing scene (${existingSceneAt.sceneStart}-${existingSceneAt.sceneEnd})`);
        return;
    }

    // Create the scene
    const result = await createSceneChunk(
        pendingSceneStart,
        messageId,
        {},
        currentSettings,
    );

    if (result.success) {
        toastr.success(`Scene created (messages ${pendingSceneStart}-${messageId})`);
        pendingSceneStart = null;
        await refreshSceneCache();
        updateAllMarkerStates();
        eventSource.emit('vecthare_scenes_changed');
    } else {
        toastr.error(result.error || 'Failed to create scene');
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initializeSceneMarkers() {
    // Watch for new messages via MutationObserver
    const chatObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.classList?.contains('mes')) {
                        attachMarkersToMessage(node);
                    }
                    const messages = node.querySelectorAll?.('.mes');
                    messages?.forEach(msg => attachMarkersToMessage(msg));
                }
            }
        }
    });

    // Start observing chat element (may not exist yet at startup)
    const startObserving = () => {
        const chat = document.getElementById('chat');
        if (chat) {
            chatObserver.observe(chat, { childList: true, subtree: true });
            // Attach to any existing messages
            attachAllMarkers();
            console.log('VectHare Scenes: Chat observer started');
        }
    };

    // Try immediately
    startObserving();

    // Update states on chat change
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        pendingSceneStart = null; // Clear pending on chat change
        // Ensure observer is running (in case chat element was recreated)
        startObserving();
        setTimeout(async () => {
            await refreshSceneCache();
            attachAllMarkers();
            updateAllMarkerStates();
        }, 100);
    });

    // Also attach markers when app is ready (covers initial load)
    eventSource.on(event_types.APP_READY, () => {
        startObserving();
        setTimeout(() => {
            attachAllMarkers();
            updateAllMarkerStates();
        }, 200);
    });

    console.log('VectHare Scenes: Markers initialized');
}
