import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, AvatarFallback } from "./avatar.js";
import { Button } from "./button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./card.js";
import { Input } from "./input.js";
import { Label } from "./label.js";
import { Separator } from "./separator.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.js";
import { Textarea } from "./textarea.js";

// SMOKE TESTS ONLY. These wrap third-party radix-ui / shadcn primitives.
// We do NOT claim behavioral coverage of the primitives themselves — only
// that our thin wrappers mount without throwing and forward the minimal
// props we rely on (label text, data-slot). Behavioral guarantees belong
// to radix-ui's own test suite, not here.
describe("shadcn primitive wrappers (third-party)", () => {
  // smoke: Button renders its label and forwards variant/size to data-* attrs
  it("Button mounts and shows its label", () => {
    const { getByText } = render(<Button>Save</Button>);
    const el = getByText("Save");
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-slot")).toBe("button");
  });

  // smoke: Button asChild renders the child element instead of a <button>
  it("Button asChild renders its child as the root", () => {
    const { getByText } = render(
      <Button asChild>
        <a href="/x">Open the docs</a>
      </Button>,
    );
    const el = getByText("Open the docs");
    expect(el.tagName).toBe("A");
  });

  // smoke: Card composition renders nested content
  it("Card composition mounts with title + content", () => {
    const { getByText } = render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    );
    expect(getByText("Title")).toBeTruthy();
    expect(getByText("Body")).toBeTruthy();
  });

  // smoke: Input mounts and forwards value/placeholder
  it("Input mounts with a placeholder", () => {
    const { getByPlaceholderText } = render(<Input placeholder="name" />);
    expect(getByPlaceholderText("name")).toBeTruthy();
  });

  // smoke: Textarea mounts and forwards a value
  it("Textarea mounts with a value", () => {
    const { getByDisplayValue } = render(<Textarea defaultValue="hello" />);
    expect(getByDisplayValue("hello")).toBeTruthy();
  });

  // smoke: Label mounts and shows text
  it("Label mounts and shows text", () => {
    const { getByText } = render(<Label>Email</Label>);
    expect(getByText("Email")).toBeTruthy();
  });

  // smoke: Separator (radix) mounts without throwing
  it("Separator mounts without throwing", () => {
    const { container } = render(<Separator />);
    // decorative radix separator renders an element with the merged classes
    expect(container.querySelector(".bg-border")).toBeTruthy();
  });

  // smoke: Avatar (radix) fallback mounts without throwing
  it("Avatar fallback mounts", () => {
    const { getByText } = render(
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(getByText("AB")).toBeTruthy();
  });

  // smoke: Tabs (radix stateful) mounts and shows the active tab's content
  it("Tabs mounts and shows the default tab content", () => {
    const { getByText } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
        <TabsContent value="b">Panel B</TabsContent>
      </Tabs>,
    );
    expect(getByText("Panel A")).toBeTruthy();
  });
});
