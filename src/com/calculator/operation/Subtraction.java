package com.calculator.operation;

/** Subtracts the right operand from the left operand. */
public class Subtraction implements Operation {

    @Override
    public double apply(double left, double right) {
        return left - right;
    }

    @Override
    public String symbol() {
        return "-";
    }

    @Override
    public String name() {
        return "Subtraction";
    }
}
