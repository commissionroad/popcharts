import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Field } from "./field";

describe("Field", () => {
  it("renders a labelled text input with no aria noise by default", () => {
    render(<Field id="budget" label="Budget" onChange={vi.fn()} value="100" />);
    const input = screen.getByRole("textbox", { name: /Budget/ });

    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("100");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).not.toHaveClass("font-mono");
  });

  it("forwards change events", () => {
    const onChange = vi.fn();
    render(<Field id="budget" label="Budget" onChange={onChange} />);

    fireEvent.change(screen.getByRole("textbox", { name: /Budget/ }), {
      target: { value: "250" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("announces an error and points the input at it", () => {
    render(
      <Field
        error="Too big"
        id="amount"
        label="Amount"
        onChange={vi.fn()}
        value="9999"
      />
    );
    const input = screen.getByRole("textbox", { name: /Amount/ });

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "amount-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Too big");
    expect(screen.getByRole("alert")).toHaveAttribute("id", "amount-error");
  });

  it("shows the hint when there is no error", () => {
    render(<Field hint="Max 5,000" id="amount" label="Amount" onChange={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: /Amount/ });

    expect(input).toHaveAttribute("aria-describedby", "amount-hint");
    expect(screen.getByText("Max 5,000")).toHaveAttribute("id", "amount-hint");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("prefers the error over the hint when both are given", () => {
    render(
      <Field
        error="Too big"
        hint="Max 5,000"
        id="amount"
        label="Amount"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole("textbox", { name: /Amount/ })).toHaveAttribute(
      "aria-describedby",
      "amount-error"
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Too big");
    expect(screen.queryByText("Max 5,000")).not.toBeInTheDocument();
  });

  it("renders a textarea when multiline", () => {
    render(<Field id="desc" label="Description" multiline onChange={vi.fn()} />);
    const textarea = screen.getByRole("textbox", { name: /Description/ });

    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).not.toHaveAttribute("aria-invalid");
    expect(textarea).not.toHaveAttribute("aria-describedby");
  });

  it("wires the error to a multiline textarea", () => {
    render(
      <Field
        error="Required"
        id="desc"
        label="Description"
        multiline
        onChange={vi.fn()}
      />
    );
    const textarea = screen.getByRole("textbox", { name: /Description/ });

    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveAttribute("aria-describedby", "desc-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });

  it("wires the hint to a multiline textarea", () => {
    render(
      <Field
        hint="Two sentences max"
        id="desc"
        label="Description"
        multiline
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole("textbox", { name: /Description/ })).toHaveAttribute(
      "aria-describedby",
      "desc-hint"
    );
  });

  it("renders a suffix beside the input", () => {
    render(<Field id="amount" label="Amount" onChange={vi.fn()} suffix="pUSD" />);

    expect(screen.getByText("pUSD")).toBeInTheDocument();
  });

  it("uses monospace styling when mono is set", () => {
    render(<Field id="address" label="Address" mono onChange={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: /Address/ })).toHaveClass("font-mono");
  });

  it("passes an explicit input type through", () => {
    render(<Field id="amount" label="Amount" onChange={vi.fn()} type="number" />);

    expect(screen.getByRole("spinbutton", { name: /Amount/ })).toHaveAttribute(
      "type",
      "number"
    );
  });
});
