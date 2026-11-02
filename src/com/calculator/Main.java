package com.calculator;

import com.calculator.core.Calculator;
import com.calculator.core.OperationRegistry;
import com.calculator.operation.Addition;
import com.calculator.operation.Division;
import com.calculator.operation.Modulus;
import com.calculator.operation.Multiplication;
import com.calculator.operation.Power;
import com.calculator.operation.Subtraction;
import com.calculator.ui.ConsoleCalculator;

/**
 * Application entry point and composition root.
 *
 * <p>This is the one place that wires the modules together: it builds the
 * registry, registers the available operations, constructs the engine, and
 * hands everything to the console UI. Adding a new operation is a one-line
 * change here (plus the new {@code Operation} class) — the rest of the
 * application is untouched.
 */
public class Main {

    public static void main(String[] args) {
        OperationRegistry registry = new OperationRegistry()
                .register(new Addition())
                .register(new Subtraction())
                .register(new Multiplication())
                .register(new Division())
                .register(new Modulus())
                .register(new Power());

        Calculator calculator = new Calculator(registry);
        new ConsoleCalculator(calculator).run();
    }
}
