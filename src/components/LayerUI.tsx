import React, {
  useRef,
  useState,
  RefObject,
  useEffect,
  useCallback,
} from "react";
import { showSelectedShapeActions } from "../element";
import { calculateScrollCenter, getSelectedElements } from "../scene";
import { exportCanvas } from "../data";

import { AppState, LibraryItems, LibraryItem } from "../types";
import { NonDeletedExcalidrawElement } from "../element/types";

import { ActionManager } from "../actions/manager";
import { Island } from "./Island";
import Stack from "./Stack";
import { FixedSideContainer } from "./FixedSideContainer";
import { UserList } from "./UserList";
import { LockIcon } from "./LockIcon";
import { ExportDialog, ExportCB } from "./ExportDialog";
import { LanguageList } from "./LanguageList";
import { t, languages, setLanguage } from "../i18n";
import { HintViewer } from "./HintViewer";
import useIsMobile from "../is-mobile";

import { ExportType } from "../scene/types";
import { MobileMenu } from "./MobileMenu";
import { ZoomActions, SelectedShapeActions, ShapesSwitcher } from "./Actions";
import { Section } from "./Section";
import { RoomDialog } from "./RoomDialog";
import { ErrorDialog } from "./ErrorDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { LoadingMessage } from "./LoadingMessage";
import { CLASSES } from "../constants";
import { shield, exportFile, load } from "./icons";
import { GitHubCorner } from "./GitHubCorner";
import { Tooltip } from "./Tooltip";

import "./LayerUI.scss";
import { LibraryUnit } from "./LibraryUnit";
import { loadLibrary, saveLibrary } from "../data/localStorage";
import { ToolButton } from "./ToolButton";
import { saveLibraryAsJSON, importLibraryFromJSON } from "../data/json";
import { muteFSAbortError } from "../utils";
import { BackgroundPickerAndDarkModeToggle } from "./BackgroundPickerAndDarkModeToggle";
import clsx from "clsx";

interface LayerUIProps {
  actionManager: ActionManager;
  appState: AppState;
  canvas: HTMLCanvasElement | null;
  setAppState: React.Component<any, AppState>["setState"];
  elements: readonly NonDeletedExcalidrawElement[];
  onRoomCreate: () => void;
  onUsernameChange: (username: string) => void;
  onRoomDestroy: () => void;
  onLockToggle: () => void;
  onInsertShape: (elements: LibraryItem) => void;
  zenModeEnabled: boolean;
  toggleZenMode: () => void;
  lng: string;
}

function useOnClickOutside(
  ref: RefObject<HTMLElement>,
  cb: (event: MouseEvent) => void,
) {
  useEffect(() => {
    const listener = (event: MouseEvent) => {
      if (!ref.current) {
        return;
      }

      if (
        event.target instanceof Element &&
        (ref.current.contains(event.target) ||
          !document.body.contains(event.target))
      ) {
        return;
      }

      cb(event);
    };
    document.addEventListener("pointerdown", listener, false);

    return () => {
      document.removeEventListener("pointerdown", listener);
    };
  }, [ref, cb]);
}

const LibraryMenuItems = ({
  library,
  onRemoveFromLibrary,
  onAddToLibrary,
  onInsertShape,
  pendingElements,
  setAppState,
}: {
  library: LibraryItems;
  pendingElements: LibraryItem;
  onClickOutside: (event: MouseEvent) => void;
  onRemoveFromLibrary: (index: number) => void;
  onInsertShape: (elements: LibraryItem) => void;
  onAddToLibrary: (elements: LibraryItem) => void;
  setAppState: React.Component<any, AppState>["setState"];
}) => {
  const isMobile = useIsMobile();
  const numCells = library.length + (pendingElements.length > 0 ? 1 : 0);
  const CELLS_PER_ROW = isMobile ? 4 : 6;
  const numRows = Math.max(1, Math.ceil(numCells / CELLS_PER_ROW));
  const rows = [];
  let addedPendingElements = false;

  rows.push(
    <Stack.Row align="center" gap={1} key={"actions"}>
      <ToolButton
        key="import"
        type="button"
        title={t("buttons.load")}
        aria-label={t("buttons.load")}
        icon={load}
        onClick={() => {
          importLibraryFromJSON()
            .then(() => {
              // Maybe we should close and open the menu so that the items get updated.
              // But for now we just close the menu.
              setAppState({ isLibraryOpen: false });
            })
            .catch(muteFSAbortError)
            .catch((error) => {
              setAppState({ errorMessage: error.message });
            });
        }}
      />
      <ToolButton
        key="export"
        type="button"
        title={t("buttons.export")}
        aria-label={t("buttons.export")}
        icon={exportFile}
        onClick={() => {
          saveLibraryAsJSON()
            .catch(muteFSAbortError)
            .catch((error) => {
              setAppState({ errorMessage: error.message });
            });
        }}
      />
    </Stack.Row>,
  );

  for (let row = 0; row < numRows; row++) {
    const i = CELLS_PER_ROW * row;
    const children = [];
    for (let j = 0; j < CELLS_PER_ROW; j++) {
      const shouldAddPendingElements: boolean =
        pendingElements.length > 0 &&
        !addedPendingElements &&
        i + j >= library.length;
      addedPendingElements = addedPendingElements || shouldAddPendingElements;

      children.push(
        <Stack.Col key={j}>
          <LibraryUnit
            elements={library[i + j]}
            pendingElements={
              shouldAddPendingElements ? pendingElements : undefined
            }
            onRemoveFromLibrary={onRemoveFromLibrary.bind(null, i + j)}
            onClick={
              shouldAddPendingElements
                ? onAddToLibrary.bind(null, pendingElements)
                : onInsertShape.bind(null, library[i + j])
            }
          />
        </Stack.Col>,
      );
    }
    rows.push(
      <Stack.Row align="center" gap={1} key={row}>
        {children}
      </Stack.Row>,
    );
  }

  return (
    <Stack.Col align="center" gap={1} className="layer-ui__library-items">
      {rows}
    </Stack.Col>
  );
};

const LibraryMenu = ({
  onClickOutside,
  onInsertShape,
  pendingElements,
  onAddToLibrary,
  setAppState,
}: {
  pendingElements: LibraryItem;
  onClickOutside: (event: MouseEvent) => void;
  onInsertShape: (elements: LibraryItem) => void;
  onAddToLibrary: () => void;
  setAppState: React.Component<any, AppState>["setState"];
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useOnClickOutside(ref, onClickOutside);

  const [libraryItems, setLibraryItems] = useState<LibraryItems>([]);

  const [loadingState, setIsLoading] = useState<
    "preloading" | "loading" | "ready"
  >("preloading");

  const loadingTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    Promise.race([
      new Promise((resolve) => {
        loadingTimerRef.current = setTimeout(() => {
          resolve("loading");
        }, 100);
      }),
      loadLibrary().then((items) => {
        setLibraryItems(items);
        setIsLoading("ready");
      }),
    ]).then((data) => {
      if (data === "loading") {
        setIsLoading("loading");
      }
    });
    return () => {
      clearTimeout(loadingTimerRef.current!);
    };
  }, []);

  const removeFromLibrary = useCallback(async (indexToRemove) => {
    const items = await loadLibrary();
    const nextItems = items.filter((_, index) => index !== indexToRemove);
    saveLibrary(nextItems);
    setLibraryItems(nextItems);
  }, []);

  const addToLibrary = useCallback(
    async (elements: LibraryItem) => {
      const items = await loadLibrary();
      const nextItems = [...items, elements];
      onAddToLibrary();
      saveLibrary(nextItems);
      setLibraryItems(nextItems);
    },
    [onAddToLibrary],
  );

  return loadingState === "preloading" ? null : (
    <Island padding={1} ref={ref} className="layer-ui__library">
      {loadingState === "loading" ? (
        <div className="layer-ui__library-message">
          {t("labels.libraryLoadingMessage")}
        </div>
      ) : (
        <LibraryMenuItems
          library={libraryItems}
          onClickOutside={onClickOutside}
          onRemoveFromLibrary={removeFromLibrary}
          onAddToLibrary={addToLibrary}
          onInsertShape={onInsertShape}
          pendingElements={pendingElements}
          setAppState={setAppState}
        />
      )}
    </Island>
  );
};

const LayerUI = ({
  actionManager,
  appState,
  setAppState,
  canvas,
  elements,
  onRoomCreate,
  onUsernameChange,
  onRoomDestroy,
  onLockToggle,
  onInsertShape,
  zenModeEnabled,
  toggleZenMode,
}: LayerUIProps) => {
  const isMobile = useIsMobile();

  // TODO: Extend tooltip component and use here.
  const renderEncryptedIcon = () => (
    <a
      className={clsx("encrypted-icon tooltip zen-mode-visibility", {
        "zen-mode-visibility--hidden": zenModeEnabled,
      })}
      href="https://blog.excalidraw.com/end-to-end-encryption/"
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="tooltip-text" dir="auto">
        {t("encrypted.tooltip")}
      </span>
      {shield}
    </a>
  );

  const renderExportDialog = () => {
    const createExporter = (type: ExportType): ExportCB => async (
      exportedElements,
      scale,
    ) => {
      if (canvas) {
        try {
          await exportCanvas(type, exportedElements, appState, canvas, {
            exportBackground: appState.exportBackground,
            name: appState.name,
            viewBackgroundColor: appState.viewBackgroundColor,
            scale,
            shouldAddWatermark: appState.shouldAddWatermark,
          });
        } catch (error) {
          console.error(error);
          setAppState({ errorMessage: error.message });
        }
      }
    };
    return (
      <ExportDialog
        elements={elements}
        appState={appState}
        actionManager={actionManager}
        onExportToPng={createExporter("png")}
        onExportToSvg={createExporter("svg")}
        onExportToClipboard={createExporter("clipboard")}
        onExportToBackend={async (exportedElements) => {
          if (canvas) {
            try {
              await exportCanvas(
                "backend",
                exportedElements,
                {
                  ...appState,
                  selectedElementIds: {},
                },
                canvas,
                appState,
              );
            } catch (error) {
              console.error(error);
              setAppState({ errorMessage: error.message });
            }
          }
        }}
      />
    );
  };

  const renderCanvasActions = () => (
    <Section
      heading="canvasActions"
      className={clsx("zen-mode-transition", {
        "transition-left": zenModeEnabled,
      })}
    >
      {/* the zIndex ensures this menu has higher stacking order,
         see https://github.com/AnushkaKRajasingha/demo-conceptboard