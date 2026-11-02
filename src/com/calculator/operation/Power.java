package com.calculator.operation;

/** Raises the left operand to the power of the right operand. */
public class Power implements Operation {

    @Override
    public double apply(double left, double right) {
        return Math.pow(left, right);
    }

    @Override
    public String symbol() {
        return "^";
    }

    @Override
    public String name() {
        return "Power";
    }
}
