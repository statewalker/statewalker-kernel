import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@statewalker/ui.view.shadcn";
import { type ComponentType, useEffect, useState } from "react";
import type {
  FragmentSettings,
  Settings,
  SettingsField,
  SettingsPage,
  SettingsState,
  SettingValue,
} from "../src/index.js";

/**
 * The settings view: every enabled fragment's page, each setting a shadcn control rendered from
 * its schema (a choice for `enum`, a checkbox for a boolean, a field for a string or a number).
 * A value is stored as it changes; one the schema refuses is shown with the reason, not stored.
 */
export function SettingsView({ settings }: { settings: Settings }) {
  const [state, setState] = useState<SettingsState>(() => settings.state());
  useEffect(() => settings.observe(setState), [settings]);
  return (
    <div data-testid="settings-view" className="flex flex-col gap-4 overflow-auto p-4">
      {state.pages.length === 0 && (
        <p className="m-0 text-sm text-muted-foreground">No fragment has settings.</p>
      )}
      {state.pages.map((page) => (
        <SettingsPageCard
          key={page.fragment}
          page={page}
          values={state.values[page.fragment] ?? {}}
          scoped={settings.of(page.fragment)}
        />
      ))}
    </div>
  );
}

function SettingsPageCard({
  page,
  values,
  scoped,
}: {
  page: SettingsPage;
  values: Readonly<Record<string, SettingValue>>;
  scoped: FragmentSettings;
}) {
  return (
    <Card data-testid="settings-page" data-fragment={page.fragment}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {page.title}
        </CardTitle>
        {page.description && <CardDescription>{page.description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {page.fields.map((field) => (
          <SettingControl
            key={field.key}
            id={`setting-${page.fragment}-${field.key}`}
            field={field}
            value={values[field.key]}
            scoped={scoped}
          />
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => scoped.reset()}>
            Reset to defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingControl({
  id,
  field,
  value,
  scoped,
}: {
  id: string;
  field: SettingsField;
  value: SettingValue | undefined;
  scoped: FragmentSettings;
}) {
  const [problem, setProblem] = useState<string>();
  function store(next: unknown) {
    try {
      scoped.set(field.key, next);
      setProblem(undefined);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }
  const describedBy = field.description ? `${id}-description` : undefined;
  return (
    <div className="flex flex-col gap-1.5" data-setting={field.key}>
      {field.type === "boolean" ? (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="checkbox"
            className="size-4 accent-primary"
            checked={value === true}
            aria-describedby={describedBy}
            onChange={(event) => store(event.target.checked)}
          />
          <Label htmlFor={id}>{field.title}</Label>
        </div>
      ) : (
        <>
          <Label htmlFor={id}>{field.title}</Label>
          {field.enum ? (
            <Choice id={id} field={field} value={value} onChange={store} />
          ) : (
            <TextField id={id} field={field} value={value} onChange={store} />
          )}
        </>
      )}
      {field.description && (
        <p id={describedBy} className="m-0 text-xs text-muted-foreground">
          {field.description}
        </p>
      )}
      {problem && (
        <p role="alert" className="m-0 text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

interface ControlProps {
  id: string;
  field: SettingsField;
  value: SettingValue | undefined;
  onChange: (value: unknown) => void;
}

/** An `enum`: a shadcn Select over the values (Radix takes strings: matched back by position). */
function Choice({ id, field, value, onChange }: ControlProps) {
  const options = field.enum ?? [];
  const index = options.indexOf(value as string | number);
  return (
    <Select
      value={index < 0 ? "" : String(index)}
      onValueChange={(picked) => onChange(options[Number(picked)])}
    >
      <SelectTrigger id={id} className="w-64">
        <SelectValue placeholder="Choose" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option, i) => (
          <SelectItem key={String(option)} value={String(i)}>
            {String(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A string or a number: a field, its text kept while it is being typed, stored as it changes. */
function TextField({ id, field, value, onChange }: ControlProps) {
  const numeric = field.type === "number" || field.type === "integer";
  const [text, setText] = useState(value === undefined ? "" : String(value));
  // A value changed elsewhere (a reset) shows; the text being typed stays while it matches.
  useEffect(() => {
    setText((current) => {
      const shown = value === undefined ? "" : String(value);
      return numeric && current !== "" && Number(current) === value ? current : shown;
    });
  }, [value, numeric]);
  return (
    <Input
      id={id}
      className="w-64"
      type={numeric ? "number" : "text"}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const raw = event.target.value;
        onChange(numeric ? (raw.trim() === "" ? undefined : Number(raw)) : raw);
      }}
    />
  );
}

/**
 * The fragment's client module, bound to the model: what its view extension's reference
 * (`./index.js`, `SettingsView`) resolves to in the host.
 */
export function settingsModule(settings: Settings): Record<string, unknown> {
  const View: ComponentType = () => <SettingsView settings={settings} />;
  return { SettingsView: View };
}
