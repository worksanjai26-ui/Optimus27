package com.calculator.ui;

import com.calculator.core.Calculator;
import com.calculator.exception.CalculatorException;
import com.calculator.operation.Operation;

import java.util.Scanner;

/**
 * Interactive console front-end for the calculator.
 *
 * <p>This class owns all user interaction (prompts, parsing, error messages)
 * and delegates every actual computation to {@link Calculator}. Swapping this
 * for a GUI or web layer would not require touching the core or operations.
 */
public class ConsoleCalculator {

    private final Calculator calculator;
    private final Scanner scanner;

    public ConsoleCalculator(Calculator calculator) {
        this(calculator, new Scanner(System.in));
    }

    public ConsoleCalculator(Calculator calculator, Scanner scanner) {
        this.calculator = calculator;
        this.scanner = scanner;
    }

    /** Runs the read-evaluate-print loop until the user quits. */
    public void run() {
        printWelcome();
        while (true) {
            System.out.print("\nEnter operation (or 'q' to quit): ");
            String symbol = scanner.next().trim();

            if (isQuit(symbol)) {
                System.out.println("Goodbye!");
                return;
            }

            if (!calculator.registry().supports(symbol)) {
                System.out.println("Unknown operation '" + symbol + "'. Type one of the symbols listed above.");
                continue;
            }

            try {
                double left = readOperand("Enter first number:  ");
                double right = readOperand("Enter second number: ");
                double result = calculator.calculate(symbol, left, right);
                System.out.printf("Result: %s %s %s = %s%n",
                        format(left), symbol, format(right), format(result));
            } catch (CalculatorException ex) {
                System.out.println("Error: " + ex.getMessage());
            }
        }
    }

    private double readOperand(String prompt) {
        while (true) {
            System.out.print(prompt);
            String token = scanner.next();
            try {
                return Double.parseDouble(token);
            } catch (NumberFormatException ex) {
                System.out.println("'" + token + "' is not a valid number. Try again.");
            }
        }
    }

    private void printWelcome() {
        System.out.println("=== Modular Java Calculator ===");
        System.out.println("Available operations:");
        for (Operation operation : calculator.registry().all()) {
            System.out.printf("  %-2s  %s%n", operation.symbol(), operation.name());
        }
    }

    private boolean isQuit(String input) {
        return input.equalsIgnoreCase("q") || input.equalsIgnoreCase("quit");
    }

    /** Prints whole numbers without a trailing ".0" for readability. */
    private String format(double value) {
        if (value == Math.floor(value) && !Double.isInfinite(value)) {
            return Long.toString((long) value);
        }
        return Double.toString(value);
    }
}
