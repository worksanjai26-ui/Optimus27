package com.calculator.operation;

/** Adds the right operand to the left operand. */
public class Addition implements Operation {

    @Override
    public double apply(double left, double right) {
        return left + right;
    }

    @Override
    public String symbol() {
        return "+";
    }

    @Override
    public String name() {
        return "Addition";
    }
}
