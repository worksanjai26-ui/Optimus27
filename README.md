# Modular Java Calculator

A small, modular console calculator that demonstrates organizing classes into
Java **packages** and designing for **code reusability**. Each concern lives in
its own package, and new operations plug in without touching the engine or UI.

## Package structure

```
src/
└── com/
    └── calculator/
        ├── Main.java                 # Composition root (wires modules together)
        ├── core/
        │   ├── Calculator.java        # Calculation engine (delegates to operations)
        │   └── OperationRegistry.java # Pluggable registry of operations
        ├── operation/
        │   ├── Operation.java         # Interface — the single extension point
        │   ├── Addition.java          # +
        │   ├── Subtraction.java       # -
        │   ├── Multiplication.java    # *
        │   ├── Division.java          # /
        │   ├── Modulus.java           # %
        │   └── Power.java             # ^
        ├── exception/
        │   ├── CalculatorException.java        # Root domain exception
        │   ├── DivisionByZeroException.java
        │   └── UnknownOperationException.java
        └── ui/
            └── ConsoleCalculator.java # Interactive console front-end
```

## How the design promotes reusability

- **`operation`** — every operation implements one small `Operation` interface.
  The engine and UI depend on the interface, never on concrete classes.
- **`core`** — `Calculator` only resolves an operation and applies it;
  `OperationRegistry` is the plug-in seam where operations are registered.
- **`ui`** — handles all input/output and reuses the same engine; it could be
  replaced by a GUI or web layer without changing `core` or `operation`.
- **`exception`** — a single exception hierarchy lets any layer handle failures
  consistently.

**Adding a new operation** takes two small steps: create a class implementing
`Operation`, then add one `.register(...)` line in `Main`. Nothing else changes.

## Build and run

From the project root (`C:\optimus26-site`):

```bash
javac -d out (Get-ChildItem -Recurse src -Filter *.java).FullName
```

If you are in PowerShell use the line above; in bash/cmd, compile explicitly:

```bash
javac -d out src/com/calculator/Main.java src/com/calculator/core/*.java src/com/calculator/operation/*.java src/com/calculator/exception/*.java src/com/calculator/ui/*.java
```

Then run:

```bash
java -cp out com.calculator.Main
```

> **Note:** No JDK was found on this machine when the project was created.
> Install a JDK (e.g. [Adoptium Temurin 21](https://adoptium.net/)) and ensure
> `java` / `javac` are on your `PATH` before building.

## Example session

```
=== Modular Java Calculator ===
Available operations:
  +   Addition
  -   Subtraction
  *   Multiplication
  /   Division
  %   Modulus
  ^   Power

Enter operation (or 'q' to quit): /
Enter first number:  10
Enter second number: 4
Result: 10 / 4 = 2.5
```
