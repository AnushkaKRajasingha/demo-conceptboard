import React from "react";

import rough from "roughjs/bin/rough";
import { RoughCanvas } from "roughjs/bin/canvas";
import { simplify, Point } from "points-on-curve";
import { SocketUpdateData } from "../types";

import {
  newElement,
  newTextElement,
  duplicateElement,
  isInvisiblySmallElement,
  isTextElement,
  textWysiwyg,
  getCommonBounds,
  getCursorForResizingElement,
  getPerfectElementSize,
  getNormalizedDimensions,
  getElementMap,
  getSceneVersion,
  getSyncableElements,
  newLinearElement,
  transformElements,
  getElementWithTransformHandleType,
  getResizeOffsetXY,
  getResizeArrowDirection,
  getTransformHandleTypeFromCoords,
  isNonDeletedElement,
  updateTextElement,
  dragSelectedElements,
  getDragOffsetXY,
  dragNewElement,
  hitTest,
  isHittingElementBoundingBoxWithoutHittingElement,
  getNonDeletedElements,
} from "../element";
import {
  getElementsWithinSelection,
  isOverScrollBars,
  getElementsAtPosition,
  getElementContainingPosition,
  getNormalizedZoom,
  getSelectedElements,
  isSomeElementSelected,
  calculateScrollCenter,
} from "../scene";
import {
  decryptAESGEM,
  loadScene,
  loadFromBlob,
  SOCKET_SERVER,
  SocketUpdateDataSource,
  exportCanvas,
} from "../data";
import Portal from "./Portal";

import { renderScene } from "../renderer";
import { AppState, GestureEvent, Gesture, ExcalidrawProps } from "../types";
import {
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeleted,
  ExcalidrawGenericElement,
  ExcalidrawLinearElement,
  ExcalidrawBindableElement,
} from "../element/types";

import { distance2d, isPathALoop, getGridPoint } from "../math";

import {
  isWritableElement,
  isInputLike,
  isToolIcon,
  debounce,
  distance,
  resetCursor,
  viewportCoordsToSceneCoords,
  sceneCoordsToViewportCoords,
  setCursorForShape,
  tupleToCoors,
} from "../utils";
import {
  KEYS,
  isArrowKey,
  getResizeCenterPointKey,
  getResizeWithSidesSameLengthKey,
  getRotateWithDiscreteAngleKey,
} from "../keys";

import { findShapeByKey } from "../shapes";
import { createHistory, SceneHistory } from "../history";

import ContextMenu from "./ContextMenu";

import { ActionManager } from "../actions/manager";
import "../actions";
import { actions } from "../actions/register";

import { ActionResult } from "../actions/types";
import { getDefaultAppState } from "../appState";
import { t, getLanguage } from "../i18n";

import {
  copyToClipboard,
  parseClipboard,
  probablySupportsClipboardBlob,
  probablySupportsClipboardWriteText,
} from "../clipboard";
import { normalizeScroll } from "../scene";
import { getCenter, getDistance } from "../gesture";
import { createUndoAction, createRedoAction } from "../actions/actionHistory";

import {
  CURSOR_TYPE,
  ELEMENT_SHIFT_TRANSLATE_AMOUNT,
  ELEMENT_TRANSLATE_AMOUNT,
  POINTER_BUTTON,
  DRAGGING_THRESHOLD,
  TEXT_TO_CENTER_SNAP_THRESHOLD,
  LINE_CONFIRM_THRESHOLD,
  SCENE,
  EVENT,
  ENV,
  CANVAS_ONLY_ACTIONS,
  DEFAULT_VERTICAL_ALIGN,
  GRID_SIZE,
  LOCAL_STORAGE_KEY_COLLAB_FORCE_FLAG,
  MIME_TYPES,
} from "../constants";
import {
  INITIAL_SCENE_UPDATE_TIMEOUT,
  TAP_TWICE_TIMEOUT,
  SYNC_FULL_SCENE_INTERVAL_MS,
  TOUCH_CTX_MENU_TIMEOUT,
} from "../time_constants";

import LayerUI from "./LayerUI";
import { ScrollBars, SceneState } from "../scene/types";
import { generateCollaborationLink, getCollaborationLinkData } from "../data";
import { mutateElement } from "../element/mutateElement";
import { invalidateShapeForElement } from "../renderer/renderElement";
import { unstable_batchedUpdates } from "react-dom";
import {
  isLinearElement,
  isLinearElementType,
  isBindingElement,
  isBindingElementType,
} from "../element/typeChecks";
import { actionFinalize, actionDeleteSelected } from "../actions";
import { loadLibrary } from "../data/localStorage";

import throttle from "lodash.throttle";
import { LinearElementEditor } from "../element/linearElementEditor";
import {
  getSelectedGroupIds,
  isSelectedViaGroup,
  selectGroupsForSelectedElements,
  isElementInGroup,
  getSelectedGroupIdForElement,
  getElementsInGroup,
  editGroupForSelectedElement,
} from "../groups";
import { Library } from "../data/library";
import Scene from "../scene/Scene";
import {
  getHoveredElementForBinding,
  maybeBindLinearElement,
  getEligibleElementsForBinding,
  bindOrUnbindSelectedElements,
  unbindLinearElements,
  fixBindingsAfterDuplication,
  fixBindingsAfterDeletion,
  isLinearElementSimpleAndAlreadyBound,
  isBindingEnabled,
  updateBoundElements,
  shouldEnableBindingForPointerEvent,
} from "../element/binding";
import { MaybeTransformHandleType } from "../element/transformHandles";
import { renderSpreadsheet } from "../charts";
import { isValidLibrary } from "../data/json";
import {
  loadFromFirebase,
  saveToFirebase,
  isSavedToFirebase,
} from "../data/firebase";

/**
 * @param func handler taking at most single parameter (event).
 */
const withBatchedUpdates = <
  TFunction extends ((event: any) => void) | (() => void)
>(
  func: Parameters<TFunction>["length"] extends 0 | 1 ? TFunction : never,
) =>
  ((event) => {
    unstable_batchedUpdates(func as TFunction, event);
  }) as TFunction;

const { history } = createHistory();

let didTapTwice: boolean = false;
let tappedTwiceTimer = 0;
let cursorX = 0;
let cursorY = 0;
let isHoldingSpace: boolean = false;
let isPanning: boolean = false;
let isDraggingScrollBar: boolean = false;
let currentScrollBars: ScrollBars = { horizontal: null, vertical: null };
let touchTimeout = 0;
let touchMoving = false;

let lastPointerUp: ((event: any) => void) | null = null;
const gesture: Gesture = {
  pointers: new Map(),
  lastCenter: null,
  initialDistance: null,
  initialScale: null,
};

export type PointerDownState = Readonly<{
  // The first position at which pointerDown happened
  origin: Readonly<{ x: number; y: number }>;
  // Same as "origin" but snapped to the grid, if grid is on
  originInGrid: Readonly<{ x: number; y: number }>;
  // Scrollbar checks
  scrollbars: ReturnType<typeof isOverScrollBars>;
  // The previous pointer position
  lastCoords: { x: number; y: number };
  // map of original elements data
  // (for now only a subset of props for perf reasons)
  originalElements: Map<string, Pick<ExcalidrawElement, "x" | "y" | "angle">>;
  resize: {
    // Handle when resizing, might change during the pointer interaction
    handleType: MaybeTransformHandleType;
    // This is determined on the initial pointer down event
    isResizing: boolean;
    // This is determined on the initial pointer down event
    offset: { x: number; y: number };
    // This is determined on the initial pointer down event
    arrowDirection: "origin" | "end";
    // This is a center point of selected elements determined on the initial pointer down event (for rotation only)
    center: { x: number; y: number };
  };
  hit: {
    // The element the pointer is "hitting", is determined on the initial
    // pointer down event
    element: NonDeleted<ExcalidrawElement> | null;
    // The elements the pointer is "hitting", is determined on the initial
    // pointer down event
    allHitElements: NonDeleted<ExcalidrawElement>[];
    // This is determined on the initial pointer down event
    wasAddedToSelection: boolean;
    // Whether selected element(s) were duplicated, might change during the
    // pointer interaction
    hasBeenDuplicated: boolean;
    hasHitCommonBoundingBoxOfSelectedElements: boolean;
  };
  drag: {
    // Might change during the pointer interation
    hasOccurred: boolean;
    // Might change during the pointer interation
    offset: { x: number; y: number } | null;
  };
  // We need to have these in the state so that we can unsubscribe them
  eventListeners: {
    // It's defined on the initial pointer down event
    onMove: null | ((event: PointerEvent) => void);
    // It's defined on the initial pointer down event
    onUp: null | ((event: PointerEvent) => void);
  };
}>;

export type ExcalidrawImperativeAPI =
  | {
      updateScene: InstanceType<typeof App>["updateScene"];
    }
  | undefined;

class App extends React.Component<ExcalidrawProps, AppState> {
  canvas: HTMLCanvasElement | null = null;
  rc: RoughCanvas | null = null;
  portal: Portal = new Portal(this);
  lastBroadcastedOrReceivedSceneVersion: number = -1;
  broadcastedElementVersions: Map<string, number> = new Map();
  unmounted: boolean = false;
  actionManager: ActionManager;
  private excalidrawRef: any;
  private socketInitializationTimer: any;

  public static defaultProps: Partial<ExcalidrawProps> = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  private scene: Scene;

  constructor(props: ExcalidrawProps) {
    super(props);
    const defaultAppState = getDefaultAppState();

    const { width, height, user, forwardedRef } = props;
    this.state = {
      ...defaultAppState,
      isLoading: true,
      width,
      height,
      username: user?.name || "",
      ...this.getCanvasOffsets(),
    };
    if (forwardedRef && "current" in forwardedRef) {
      forwardedRef.current = {
        updateScene: this.updateScene,
      };
    }
    this.scene = new Scene();
    this.excalidrawRef = React.createRef();
    this.actionManager = new ActionManager(
      this.syncActionResult,
      () => this.state,
      () => this.scene.getElementsIncludingDeleted(),
    );
    this.actionManager.registerAll(actions);

    this.actionManager.registerAction(createUndoAction(history));
    this.actionManager.registerAction(createRedoAction(history));
  }

  public render() {
    const {
      zenModeEnabled,
      width: canvasDOMWidth,
      height: canvasDOMHeight,
      offsetTop,
      offsetLeft,
    } = this.state;

    const { onUsernameChange } = this.props;
    const canvasScale = window.devicePixelRatio;

    const canvasWidth = canvasDOMWidth * canvasScale;
    const canvasHeight = canvasDOMHeight * canvasScale;

    return (
      <div
        className="excalidraw"
        ref={this.excalidrawRef}
        style={{
          width: canvasDOMWidth,
          height: canvasDOMHeight,
          top: offsetTop,
          left: offsetLeft,
        }}
      >
        <LayerUI
          canvas={this.canvas}
          appState={this.state}
          setAppState={this.setAppState}
          actionManager={this.actionManager}
          elements={this.scene.getElements()}
          onRoomCreate={this.openPortal}
          onRoomDestroy={this.closePortal}
          onUsernameChange={(username) => {
            onUsernameChange && onUsernameChange(username);
            this.setState({ username });
          }}
          onLockToggle={this.toggleLock}
          onInsertShape={(elements) =>
            this.addElementsFromPasteOrLibrary(elements)
          }
          zenModeEnabled={zenModeEnabled}
          toggleZenMode={this.toggleZenMode}
          lng={getLanguage().lng}
        />
        <main>
          <canvas
            id="canvas"
            style={{
              width: canvasDOMWidth,
              height: canvasDOMHeight,
            }}
            width={canvasWidth}
            height={canvasHeight}
            ref={this.handleCanvasRef}
            onContextMenu={this.handleCanvasContextMenu}
            onPointerDown={this.handleCanvasPointerDown}
            onDoubleClick={this.handleCanvasDoubleClick}
            onPointerMove={this.handleCanvasPointerMove}
            onPointerUp={this.removePointer}
            onPointerCancel={this.removePointer}
            onTouchMove={this.handleTouchMove}
            onDrop={this.handleCanvasOnDrop}
          >
            {t("labels.drawingCanvas")}
          </canvas>
        </main>
      </div>
    );
  }

  private syncActionResult = withBatchedUpdates(
    (actionResult: ActionResult) => {
      if (this.unmounted || actionResult === false) {
        return;
      }

      let editingElement: AppState["editingElement"] | null = null;
      if (actionResult.elements) {
        actionResult.elements.forEach((element) => {
          if (
            this.state.editingElement?.id === element.id &&
            this.state.editingElement !== element &&
            isNonDeletedElement(element)
          ) {
            editingElement = element;
          }
        });
        this.scene.replaceAllElements(actionResult.elements);
        if (actionResult.commitToHistory) {
          history.resumeRecording();
        }
      }

      if (actionResult.appState || editingElement) {
        if (actionResult.commitToHistory) {
          history.resumeRecording();
        }
        this.setState(
          (state) => ({
            ...actionResult.appState,
            editingElement:
              editingElement || actionResult.appState?.editingElement || null,
            isCollaborating: state.isCollaborating,
            collaborators: state.collaborators,
            width: state.width,
            height: state.height,
            offsetTop: state.offsetTop,
            offsetLeft: state.offsetLeft,
          }),
          () => {
            if (actionResult.syncHistory) {
              history.setCurrentState(
                this.state,
                this.scene.getElementsIncludingDeleted(),
              );
            }
          },
        );
      }
    },
  );

  // Lifecycle

  private onBlur = withBatchedUpdates(() => {
    isHoldingSpace = false;
    this.setState({ isBindingEnabled: true });
  });

  private onUnload = () => {
    this.destroySocketClient();
    this.onBlur();
  };

  private disableEvent: EventHandlerNonNull = (event) => {
    event.preventDefault();
  };

  private onFontLoaded = () => {
    this.scene.getElementsIncludingDeleted().forEach((element) => {
      if (isTextElement(element)) {
        invalidateShapeForElement(element);
      }
    });
    this.onSceneUpdated();
  };

  private shouldForceLoadScene(
    scene: ResolutionType<typeof loadScene>,
  ): boolean {
    if (!scene.elements.length) {
      return true;
    }

    const roomMatch = getCollaborationLinkData(window.location.href);

    if (!roomMatch) {
      return false;
    }

    const roomID = roomMatch[1];

    let collabForceLoadFlag;
    try {
      collabForceLoadFlag = localStorage?.getItem(
        LOCAL_STORAGE_KEY_COLLAB_FORCE_FLAG,
      );
    } catch {}

    if (collabForceLoadFlag) {
      try {
        const {
          room: previousRoom,
          timestamp,
        }: { room: string; timestamp: number } = JSON.parse(
          collabForceLoadFlag,
        );
        // if loading same room as the one previously unloaded within 15sec
        //  force reload without prompting
        if (previousRoom === roomID && Date.now() - timestamp < 15000) {
          return true;
        }
      } catch {}
    }
    return false;
  }

  private addToLibrary = async (url: string) => {
    window.history.replaceState({}, "Excalidraw", window.location.origin);
    try {
      const request = await fetch(url);
      const blob = await request.blob();
      const json = JSON.parse(await blob.text());
      if (!isValidLibrary(json)) {
        throw new Error();
      }
      if (
        window.confirm(
          t("alerts.confirmAddLibrary", { numShapes: json.library.length }),
        )
      ) {
        await Library.importLibrary(blob);
        this.setState({
          isLibraryOpen: true,
        });
      }
    } catch (error) {
      window.alert(t("alerts.errorLoadingLibrary"));
      console.error(error);
    }
  };

  /** Completely resets scene & history.
   * Do not use for clear scene user action. */
  private resetScene = withBatchedUpdates(() => {
    this.scene.replaceAllElements([]);
    this.setState({
      ...getDefaultAppState(),
      appearance: this.state.appearance,
      username: this.state.username,
    });
    history.clear();
  });

  private initializeScene = async () => {
    if ("launchQueue" in window && "LaunchParams" in window) {
      (window as any).launchQueue.setConsumer(
        async (launchParams: { files: any[] }) => {
          if (!launchParams.files.length) {
            return;
          }
          const fileHandle = launchParams.files[0];
          const blob: Blob = await fileHandle.getFile();
          blob.handle = fileHandle;
          loadFromBlob(blob, this.state)
            .then(({ elements, appState }) =>
              this.syncActionResult({
                elements,
                appState: {
                  ...(appState || this.state),
                  isLoading: false,
                },
                commitToHistory: true,
              }),
            )
            .catch((error) => {
              this.setState({ isLoading: false, errorMessage: error.message });
            });
        },
      );
    }

    const searchParams = new URLSearchParams(window.location.search);
    const id = searchParams.get("id");
    const jsonMatch = window.location.hash.match(
      /^#json=([0-9]+),([a-zA-Z0-9_-]+)$/,
    );

    if (!this.state.isLoading) {
      this.setState({ isLoading: true });
    }

    let scene = await loadScene(null, null, this.props.initialData);

    let isCollaborationScene = !!getCollaborationLinkData(window.location.href);
    const isExternalScene = !!(id || jsonMatch || isCollaborationScene);

    if (isExternalScene) {
      if (
        this.shouldForceLoadScene(scene) ||
        window.confirm(t("alerts.loadSceneOverridePrompt"))
      ) {
        // Backwards compatibility with legacy url format
        if (id) {
          scene = await loadScene(id, null, this.props.initialData);
        } else if (jsonMatch) {
          scene = await loadScene(
            jsonMatch[1],
            jsonMatch[2],
            this.props.initialData,
          );
        }
        if (!isCollaborationScene) {
          window.history.replaceState({}, "Excalidraw", window.location.origin);
        }
      } else {
        // https://github.com/AnushkaKRajasingha/demo-conceptboard