package com.calculator.core;

import com.calculator.operation.Operation;

/**
 * The calculation engine.
 *
 * <p>The engine is deliberately thin: it knows how to resolve an operation
 * from the {@link OperationRegistry} and apply it, but it knows nothing about
 * how operations are implemented or how input reaches it. This separation is
 * what lets the same engine back a console app, a GUI, or a test harness.
 */
public class Calculator {

    private final OperationRegistry registry;

    public Calculator(OperationRegistry registry) {
        this.registry = registry;
    }

    /**
     * Resolves the operation for {@code symbol} and applies it to the operands.
     *
     * @param symbol the operation symbol (e.g. {@code "+"})
     * @param left   the left operand
     * @param right  the right operand
     * @return the computed result
     */
    public double calculate(String symbol, double left, double right) {
        Operation operation = registry.get(symbol);
        return operation.apply(left, right);
    }

    /** @return the registry backing this calculator. */
    public OperationRegistry registry() {
        return registry;
    }
}
