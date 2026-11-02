package com.calculator.operation;

/** Multiplies the two operands. */
public class Multiplication implements Operation {

    @Override
    public double apply(double left, double right) {
        return left * right;
    }

    @Override
    public String symbol() {
        return "*";
    }

    @Override
    public String name() {
        return "Multiplication";
    }
}
