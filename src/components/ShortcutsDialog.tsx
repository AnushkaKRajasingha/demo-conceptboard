import React from "react";
import { t } from "../i18n";
import { isDarwin } from "../keys";
import { Dialog } from "./Dialog";
import { getShortcutKey } from "../utils";
import "./ShortcutsDialog.scss";

const Columns = (props: { children: React.ReactNode }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
    }}
  >
    {props.children}
  </div>
);

const Column = (props: { children: React.ReactNode }) => (
  <div style={{ width: "49%" }}>{props.children}</div>
);

const ShortcutIsland = (props: {
  caption: string;
  children: React.ReactNode;
}) => (
  <div className="ShortcutsDialog-island">
    <h3 className="ShortcutsDialog-island-title">{props.caption}</h3>
    {props.children}
  </div>
);

const Shortcut = (props: {
  label: string;
  shortcuts: string[];
  isOr: boolean;
}) => {
  const isRTL = document.documentElement.getAttribute("dir") === "rtl";
  return (
    <div className="ShorcutsDialog-shortcut">
      <div
        style={{
          display: "flex",
          margin: "0",
          padding: "4px 8px",
          alignItems: "center",
        }}
      >
        <div
          style={{
            lineHeight: 1.4,
          }}
        >
          {props.label}
        </div>
        <div
          style={{
            display: "flex",
            flex: "0 0 auto",
            justifyContent: "flex-end",
            marginLeft: isRTL ? "0em" : "auto",
            marginRight: isRTL ? "auto" : "0em",
            minWidth: "30%",
          }}
        >
          {props.shortcuts.map((shortcut, index) => (
            <React.Fragment key={index}>
              <ShortcutKey>{shortcut}</ShortcutKey>
              {props.isOr &&
                index !== props.shortcuts.length - 1 &&
                t("shortcutsDialog.or")}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

Shortcut.defaultProps = {
  isOr: true,
};

const ShortcutKey = (props: { children: React.ReactNode }) => (
  <span className="ShorcutsDialog-key" {...props} />
);

const Footer = () => (
  <div className="ShortcutsDialog-footer">
    <a
      href="https://blog.excalidraw.com"
      target="_blank"
      rel="noopener noreferrer"
    >
      {t("shortcutsDialog.blog")}
    </a>
    <a
      href="https://howto.excalidraw.com"
      target="_blank"
      rel="noopener noreferrer"
    >
      {t("shortcutsDialog.howto")}
    </a>
    <a
      href="https://github.com/AnushkaKRajasingha/demo-conceptboard